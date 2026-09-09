// Capsule eligibility is deliberately narrower than warning detection.
// Only explicitly supported, completely delimited credential payloads qualify.
(() => {
  const rules = [
    // Capture group 1 is always the value; label/quotes remain outside the span.
    /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?token|aws[_\s-]*secret[_\s-]*access[_\s-]*key|azure[_\s-]*openai[_\s-]*api[_\s-]*key|AccountKey)["']?\s*[:=]\s*"([^"\\\r\n]+)"/gid,
    /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?token|aws[_\s-]*secret[_\s-]*access[_\s-]*key|azure[_\s-]*openai[_\s-]*api[_\s-]*key|AccountKey)["']?\s*[:=]\s*'([^'\\\r\n]+)'/gid,
    /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?token|aws[_\s-]*secret[_\s-]*access[_\s-]*key|azure[_\s-]*openai[_\s-]*api[_\s-]*key|AccountKey)\s*[:=]\s*([A-Za-z0-9_+\/=.!@#$%^&*?-]+)(?=$|[\s;,}\]])/gid,
    /(?<![A-Za-z0-9_./+-])(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}|AKIA[0-9A-Z]{16})(?=$|[\s"'`,;:)\]}])/gd,
  ];
  // A compound warning cannot be safely resolved by protecting an unrelated key.
  const clueNames = new Set(['Recovery phrase mention', 'RSA Private Key', 'OpenSSH Private Key',
    'PGP Private Key', 'EC Private Key', 'Generic Private Key', 'Firebase Service Account']);
  function plan(text) {
    const input = String(text || '');
    const hard = detectSecretMatches(input).filter(m => m && m.soft !== true);
    if (!hard.length) return [];
    if (hard.some(m => clueNames.has(m.name) || (!m.value && m.name !== 'Large sensitive paste'))) return [];
    const candidates = [];
    for (const rule of rules) {
      rule.lastIndex = 0;
      for (const match of input.matchAll(rule)) {
        const [index, end] = match.indices[1];
        candidates.push({ index, end, value: input.slice(index, end), start: match.index, finish: match.index + match[0].length });
      }
    }
    const selected = [];
    for (const detection of hard) {
      if (detection.name === 'Large sensitive paste' && !detection.value) continue;
      if (typeof detection.value !== 'string' || !detection.value) return [];
      let at = input.indexOf(detection.value);
      if (at < 0) return [];
      while (at >= 0) {
        const end = at + detection.value.length;
        // The candidate must enclose the entire warning match. A broad
        // detector match containing unexplained text must remain unresolved.
        const options = candidates.filter(c => (c.start <= at && c.finish >= end));
        options.sort((a, b) => (b.end - b.index) - (a.end - a.index));
        if (!options.length) return [];
        selected.push(options[0]);
        at = input.indexOf(detection.value, end);
      }
    }
    selected.sort((a, b) => a.index - b.index || b.end - a.end);
    const result = [];
    for (const span of selected) {
      const prior = result.at(-1);
      if (prior && prior.index === span.index && prior.end === span.end) continue;
      if (prior && span.index < prior.end) return [];
      result.push({ index: span.index, end: span.end, value: span.value });
    }
    return result;
  }
  globalThis.ShieldVaultCapsuleMatches = Object.freeze({ plan });
})();
