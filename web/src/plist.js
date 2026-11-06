// NeXTSTEP/OpenStep-style property list parser (Oolite's Config/*.plist format).
// Supports: /* */ and // comments, quoted and bare strings, ( ... ) arrays,
// { ... } dicts, `key = value;`, numbers, yes/no/true/false.
// shortcut: bare tokens containing // or /* are treated as comment starts;
//           Oolite only uses those inside quoted strings where we handle them.

export function parsePlist(text) {
  let i = 0;
  const n = text.length;

  function skipWs() {
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
      } else if (c === '/' && text[i + 1] === '/') {
        const e = text.indexOf('\n', i);
        i = e < 0 ? n : e + 1;
      } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i++;
      } else {
        break;
      }
    }
  }

  function readQuoted() {
    i++; // opening quote
    let s = '';
    while (i < n) {
      const c = text[i];
      if (c === '\\') { s += text[i + 1] || ''; i += 2; }
      else if (c === '"') { i++; break; }
      else { s += c; i++; }
    }
    return s;
  }

  function readBare() {
    let s = '';
    while (i < n) {
      const c = text[i];
      if (c === '"' || c === ' ' || c === '\t' || c === '\n' || c === '\r' ||
          c === ';' || c === '=' || c === ',' || c === '(' || c === ')' ||
          c === '{' || c === '}') break;
      if (c === '/' && (text[i + 1] === '*' || text[i + 1] === '/')) break;
      s += c;
      i++;
    }
    return s;
  }

  function coerce(tok) {
    if (tok === 'yes' || tok === 'YES' || tok === 'true' || tok === 'TRUE') return true;
    if (tok === 'no' || tok === 'NO' || tok === 'false' || tok === 'FALSE') return false;
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return parseFloat(tok);
    return tok;
  }

  function parseValue() {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{') {
      i++;
      const obj = {};
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (text[i] === '}') { i++; break; }
        const key = text[i] === '"' ? readQuoted() : readBare();
        skipWs();
        if (text[i] === '=') i++;
        obj[key] = parseValue();
        skipWs();
        if (text[i] === ';') i++;
      }
      return obj;
    }
    if (c === '(') {
      i++;
      const arr = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (text[i] === ')') { i++; break; }
        arr.push(parseValue());
        skipWs();
        if (text[i] === ',') i++;
      }
      return arr;
    }
    if (c === '"') return readQuoted();
    return coerce(readBare());
  }

  const result = parseValue();
  return result;
}
