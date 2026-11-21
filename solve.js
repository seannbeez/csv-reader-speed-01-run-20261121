// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly
// {columns, rows, errors} for an input {text, header}, following csv-reader's
// published reading rules: a U+FEFF at the very start is dropped; a record
// ends at LF or CRLF; a line left with no characters is no record; a CR
// outside quotes not followed by LF is dropped (stray_cr); a field that opens
// with a quote runs to the next quote that is not doubled, "" inside it is
// one quote and each CRLF or lone CR inside it is read as LF; what follows
// its closing quote, up to the next comma or line break, is appended as it
// stands (quote_junk, when the field ends); a quote that never closes is a
// literal character, and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal
// character; fields stay strings, never trimmed or converted. columns is the
// first record when header is true, else null; rows holds the records after
// it (every record when header is false), each padded with "" (short_row,
// with fields: its field count) or cut (long_row, with extra: the cut fields)
// to the first record's width. Each error is {code, line, row}, in the order
// met; line is the 1-based line its record starts on, counting every LF,
// CRLF and lone CR inside quotes, and row is its record's index in rows
// (null for the header).
//
// Speed: the reference walks one character at a time. This reader never
// does. Most records hold no quote at all, so most records are read with
// native bulk operations only — one indexOf to find the line end, one
// indexOf to prove the line holds no quote, then a single slice and a native
// split(','). Only a line that holds a quote goes through the general
// scanner, which finds unquoted delimiters with one shared regex and jumps
// from quote to quote with indexOf, slicing quoted content whole and
// transforming "" and line breaks only when the slice actually holds them.
// No object is allocated per field or per record.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // One shared delimiter regex for the general scanner's unquoted reads.
  const DELIM = /[,\r\n]/g;

  // Results of the last field read, shared so no object is allocated.
  let uValue;
  let uEnded;
  let uAdded;

  // Results of the last general record read, shared likewise.
  let gFields;
  let gQuoted;

  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Unquoted read onto `init`, up to the next comma or line break. A CR not
  // followed by LF is dropped and reported (stray_cr). Sets uValue, uEnded
  // (COMMA / LINE_BREAK / END) and uAdded (characters kept).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    DELIM.lastIndex = pos;
    for (;;) {
      const m = DELIM.exec(text);
      if (m === null) {
        if (pos < n) { value += text.slice(pos); added += n - pos; }
        pos = n;
        uValue = value; uEnded = END; uAdded = added;
        return;
      }
      const i = m.index;
      const c = m[0];
      if (c === ',') {
        value += text.slice(pos, i); added += i - pos;
        pos = i + 1;
        uValue = value; uEnded = COMMA; uAdded = added;
        return;
      }
      if (c === '\n') {
        value += text.slice(pos, i); added += i - pos;
        pos = i + 1;
        line += 1;
        uValue = value; uEnded = LINE_BREAK; uAdded = added;
        return;
      }
      // A CR: a line break when followed by LF, else a dropped stray CR.
      if (text.charCodeAt(i + 1) === 10) {
        value += text.slice(pos, i); added += i - pos;
        pos = i + 2;
        line += 1;
        uValue = value; uEnded = LINE_BREAK; uAdded = added;
        return;
      }
      value += text.slice(pos, i); added += i - pos;
      pos = i + 1;
      pushError('stray_cr');
      DELIM.lastIndex = pos;
    }
  }

  // Quoted read for a field whose opening quote is at pos. Sets uValue,
  // uEnded and uAdded (uAdded counts only junk characters appended after
  // the closing quote).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let q = text.indexOf('"', pos);
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is literal, the rest is re-read unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      readUnquoted('"');
      return;
    }
    let value = text.slice(open + 1, q);
    if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
      let breaks = 0;
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c === 10) breaks += 1;
        else if (c === 13) {
          breaks += 1;
          if (value.charCodeAt(i + 1) === 10) i += 1;
        }
      }
      line += breaks;
      value = value.split('\r\n').join('\n').split('\r').join('\n');
    }
    if (value.indexOf('"') !== -1) value = value.split('""').join('"');
    pos = q + 1;
    if (pos >= n) {
      uValue = value; uEnded = END; uAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      uValue = value; uEnded = COMMA; uAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      uValue = value; uEnded = LINE_BREAK; uAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      uValue = value; uEnded = LINE_BREAK; uAdded = 0;
      return;
    }
    // Text after the closing quote is appended as it stands.
    readUnquoted(value);
    if (uAdded > 0) pushError('quote_junk');
  }

  // Reads one record the general way (its first line holds a quote, or a
  // quoted field runs past the line). Sets gFields / gQuoted.
  function readRecordGeneral() {
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(uValue);
      ended = uEnded;
    } while (ended === COMMA);
    gFields = fields;
    gQuoted = quoted;
  }

  // Files one record's fields: width, short/long errors, columns or rows.
  function fileRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const qi = text.indexOf('"', pos);
    if (qi === -1 || qi >= lineEnd) {
      // Fast path: this record's line holds no quote, so the record ends at
      // this line break and its fields are a plain comma split.
      let segEnd = lineEnd;
      if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
      const raw = text.slice(pos, segEnd);
      let fields;
      if (raw.indexOf('\r') === -1) {
        fields = raw.split(',');
      } else {
        let stray = 0;
        for (let i = raw.indexOf('\r'); i !== -1; i = raw.indexOf('\r', i + 1)) stray += 1;
        for (let k = 0; k < stray; k++) pushError('stray_cr');
        fields = raw.split('\r').join('').split(',');
      }
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line += 1;
      fileRecord(fields, false);
      continue;
    }

    readRecordGeneral();
    fileRecord(gFields, gQuoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
