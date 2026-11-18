/** Local, rule-based, best-effort redaction. Always review before sharing. */
const SECRET_KEY = /(?:api[_-]?(?:key|token)|(?:key|token)[_-]?api|access[_-]?token|refresh[_-]?token|auth(?:orization)?[_-]?token|id[_-]?token|bearer[_-]?token|token|secret|password|passwd|pwd|credential|private[_-]?key|service[_-]?role[_-]?key|client[_-]?secret|connection[_-]?(?:string|url)|(?:database|db|redis|mongo|postgres|mysql)[_-]?(?:url|uri|password|pass|token|secret)|authorization|auth[_-]?header)/i;
const KEY_SAFE = /^[\w.-]+$/;
const isSensitiveKey = key => {
  const normalized = key.replace(/[-_.]/g, '').toLowerCase();
  if (/^(?:token|secret|password|passwd|pwd|authorization|apikey|apitoken|tokenapi|keyapi|accesskey|accesstoken|refreshtoken|authtoken|idtoken|clientsecret|privatekey|databas(eurl|epassword)|db(url|password|pass)|connectionstring|connectionurl)$/.test(normalized)) return true;
  if (/(?:apikey|apitoken|tokenapi|access_token|refreshtoken|clientsecret|privatekey|password|passwd|credential|secret|connectionstring|databaseurl|dburl|service_role_key)/i.test(normalized)) return true;
  return SECRET_KEY.test(key) && !/(?:count|length|size|limit|timeout|enabled|expires|type|name|label|prefix|placeholder|example)$/i.test(key);
};
const checkCPF = digits => {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let n=9;n<=10;n++) {
    const sum = Array.from(digits.slice(0,n), Number).reduce((a,d,i)=>a+d*(n+1-i),0);
    if ((sum*10)%11%10 !== Number(digits[n])) return false;
  }
  return true;
};
const checkCNPJ = digits => {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const weights = [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]];
  return [12,13].every((n,index)=>{const sum = weights[index].reduce((a,w,i)=>a+w*Number(digits[i]),0);return Number(digits[n]) === (sum%11 < 2 ? 0 : 11-sum%11);});
};
export const DEFAULT_DETECTIONS = Object.freeze({
  assignments: true,
  tokens: true,
  bearer: true,
  jwt: true,
  privateKeys: true,
  urlCredentials: true,
  cpf: true,
  cnpj: true,
  emails: true,
  phones: true,
  addresses: true,
  ip: true,
  uuid: true,
});

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function resolveOverlaps(candidates) {
  if (candidates.length < 2) return candidates;
  candidates.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const starts = [...new Set(candidates.map(hit => hit.start))].sort((a, b) => a - b);
  // Fenwick tree storing the maximum accepted end in each prefix block.
  // A half-open interval intersects iff a hit starting before its end extends past its start.
  const maxEnd = new Uint32Array(starts.length + 1);
  const accepted = [];
  for (const hit of candidates) {
    let end = 0;
    for (let i = lowerBound(starts, hit.end); i > 0; i -= i & -i) {
      end = Math.max(end, maxEnd[i]);
    }
    if (end > hit.start) continue;

    accepted.push(hit);
    for (let i = lowerBound(starts, hit.start) + 1; i < maxEnd.length; i += i & -i) {
      maxEnd[i] = Math.max(maxEnd[i], hit.end);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export function sanitize(source, options = {}) {
  const input = String(source ?? '');
  const settings = { ...DEFAULT_DETECTIONS, ...options };
  // Compatibility with broad options from earlier versions.
  if (Object.hasOwn(options, 'personal')) {
    for (const id of ['cpf','cnpj','emails','phones','addresses']) if (!Object.hasOwn(options,id)) settings[id] = options.personal;
  }
  if (Object.hasOwn(options, 'network') && !Object.hasOwn(options,'ip')) settings.ip = options.network;
  if (Object.hasOwn(options, 'ids') && !Object.hasOwn(options,'uuid')) settings.uuid = options.ids;
  const candidates=[];
  const addHit = (start,end,kind,replacement,priority) => {
    if (start < 0 || end <= start || input.slice(start,end) === replacement) return;
    candidates.push({start,end,kind,original:input.slice(start,end),replacement,priority});
  };
  const add=(regex,kind,replacement,priority=0,predicate=()=>true)=>{
    for(const m of input.matchAll(regex)) if(predicate(m)) addHit(m.index,m.index+m[0].length,kind,typeof replacement==='function'?replacement(m):replacement,priority);
  };

  // JSON, .env, YAML, logs and JS/Python assignments. Replace the VALUE only.
  // Deliberately limit to one line to avoid deleting unrelated code.
  const assignment = /(?:^|[\s,{;])[^\S\r\n]*(?:(?:export|const|let|var)\s+)?(["']?)([A-Za-z][\w.-]{0,100})\1\s*[:=]\s*("(?:\\.|[^"\r\n])*"|'(?:\\.|[^'\r\n])*'|`[^`\r\n]*`|[^\s,;}#\r\n]+)(?=[\s,;}#]|$)/gm;
  if (settings.assignments) for(let m; (m = assignment.exec(input)) !== null;) {
    // Keep looking after a non-sensitive field. Otherwise "Erro: apitoken=X"
    // would consume the entire line as one benign assignment and leak X.
    if(!KEY_SAFE.test(m[2]) || !isSensitiveKey(m[2])) {
      assignment.lastIndex = m.index + 1;
      continue;
    }
    if (/^authorization$/i.test(m[2]) && /^Bearer$/i.test(m[3])) continue; // handled by complete Bearer rule
    const raw=m[3], offset=m[0].lastIndexOf(raw), start=m.index+offset;
    const quoted=/^["'`]/.test(raw) && raw.length>=2 && raw[0]===raw.at(-1);
    const inner=quoted?raw.slice(1,-1):raw;
    if (!inner || /^(?:null|undefined|none|true|false)$/i.test(inner)) continue;
    const replacement = /(?:url|uri|connection)/i.test(m[2]) ? 'postgresql://usuario:senha@db.exemplo.invalid:5432/banco_teste' : /authorization|authheader/i.test(m[2]) ? 'Bearer TOKEN_FICTICIO' : 'VALOR_FICTICIO';
    addHit(start+(quoted?1:0),start+raw.length-(quoted?1:0),'Credenciais',replacement,110);
  }
  // Authorization headers even when nested or written with a different syntax.
  if(settings.bearer) add(/\bBearer\s+[^\s"'`,;}{]{6,}/gi,'Bearer tokens','Bearer TOKEN_FICTICIO',90);
  if(settings.privateKeys) add(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,'Chaves privadas','-----BEGIN PRIVATE KEY-----\nCHAVE_FICTICIA_NAO_VALIDA\n-----END PRIVATE KEY-----',100);
  if(settings.urlCredentials) add(/\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|https?|ftp):\/\/)([^\s/@:'"<>]+)(?::([^\s/@'"<>]*))?@/gi,'Credenciais em URL',m=>m[1]+'usuario_ficticio'+(m[3]!==undefined?':senha_ficticia':'')+'@',85);
  if(settings.tokens) add(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{25,})\b/g,'Tokens conhecidos','TOKEN_FICTICIO',80);
  if(settings.jwt) add(/\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\b/g,'JWTs','JWT.FICTICIO.NAO_VALIDO',85);
  {
    if(settings.emails) add(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'E-mails','usuario@exemplo.invalid',30);
    // Formatted CPF/CNPJ, plus unformatted 11-digit sequences (privacy-first: possible false positives).
    // Complete formatted CPFs only; do not redact partial values while typing.
    // Keep the CPF above phone matches in the overlap-resolution order.
    if(settings.cpf) add(/(?<![\d])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g,'CPFs','000.000.000-00',65);
    if(settings.cpf) add(/(?<![\d])\d{3}[ ]\d{3}[ ]\d{3}[ -]\d{2}(?!\d)/g,'CPFs','000.000.000-00',65);
    if(settings.cnpj) add(/(?<!\d)\d{2}[. ]\d{3}[. ]\d{3}[\/ ]\d{4}[- ]\d{2}(?!\d)/g,'CNPJs','00.000.000/0000-00',40);
    if(settings.cpf) for(const m of input.matchAll(/(?<!\d)\d{11}(?!\d)/g)) {
      const before=input.slice(Math.max(0,m.index-45),m.index);
      // When a value is explicitly labeled as telephone, don't classify it as CPF.
      if (/(?:\b(?:telefone|tel\.?|celular|cel\.?|whatsapp|whats|fone|phone|mobile|contato)\s*[:=#-]\s*)$/i.test(before)) continue;
      addHit(m.index,m.index+11,'CPFs / números de 11 dígitos','00000000000',60);
    }
    if(settings.cnpj) for(const m of input.matchAll(/(?<!\d)\d{14}(?!\d)/g)) {
      const before=input.slice(Math.max(0,m.index-32),m.index);
      if (checkCNPJ(m[0]) || /\bcnpj\s*[:=#-]?\s*$/i.test(before)) addHit(m.index,m.index+14,'CNPJs','00000000000000',38);
    }
    // Brazil: mobile (with/without DDD), landline, +55 and 0800.
    // Bare 10-digit sequences with the subscriber number starting with 9 are
    // ignored to avoid masking a mobile while only 10 of its 11 digits were typed.
    const phoneLabel=before=>/(?:\b(?:telefone|tel\.?|celular|cel\.?|whatsapp|whats|fone|phone|mobile|contato)\s*[:=#-]\s*)$/i.test(before);
    const cpfLabel=before=>/\bcpf\s*[:=#-]?\s*$/i.test(before);
    if(settings.phones) {
      for(const m of input.matchAll(/(?<!\d)(?:\+55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)/g)) {
        const before=input.slice(Math.max(0,m.index-45),m.index);
        if(cpfLabel(before)) continue;
        const digits=m[0].replace(/\D/g,'');
        const hasFormat=/[()+.\s-]/.test(m[0]);
        if(digits.length===10 && !hasFormat && !phoneLabel(before)) continue;
        addHit(m.index,m.index+m[0].length,'Telefones',digits.length>=13?' +55 (00) 90000-0000'.trim():digits.length>=11?'(00) 90000-0000':'(00) 0000-0000',(!hasFormat && !phoneLabel(before))?20:75);
      }
      // Local mobile/landline numbers need a telephone label or a hyphen.
      for(const m of input.matchAll(/(?<!\d)(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)/g)) {
        const before=input.slice(Math.max(0,m.index-45),m.index);
        if(cpfLabel(before) || (!phoneLabel(before) && !/[-.\s]/.test(m[0]))) continue;
        addHit(m.index,m.index+m[0].length,'Telefones','90000-0000',50);
      }
      add(/(?<!\d)0800[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,'Telefones','0800 000 0000',55);
    }
  }
  if(settings.addresses) {
    // Explicit field: preserve the label and mask the complete value, including
    // city/neighborhood/complement when on the same line.
    const labeled=/(?<![\p{L}\d])(?:endere[cç]o(?:\s+(?:residencial|comercial|de\s+entrega))?|logradouro|address)["']?\s*[:=]\s*(?:"([^"\r\n]{5,200})"|'([^'\r\n]{5,200})'|([^\r\n;|<>"']{5,200}))/giu;
    for(const m of input.matchAll(labeled)) {
      const value=m[1]??m[2]??m[3];
      if (/^(?:n[ãa]o\s+informado|n\/?a|nenhum|sem\s+endere[cç]o|null|undefined|\-+)\s*$/i.test(value.trim())) continue;
      const start=m.index+m[0].lastIndexOf(value);
      const end=start+value.trimEnd().length;
      addHit(start,end,'Endereços','Rua Exemplo, 000 - Bairro Exemplo, Cidade/UF',70);
    }
    // Unlabeled street addresses only when a house number (or s/n) is present.
    // Prevents masking innocent references like "Avenida Brasil" alone.
    const street=/(?<![\p{L}\p{N}])(?:Rua|R\.|Avenida|Av\.|Travessa|Tv\.|Alameda|Estrada|Rodovia|Pra[cç]a|Servid[ãa]o|Largo|Beco|Passagem)\s+/giu;
    for(const m of input.matchAll(street)) {
      const rest=input.slice(m.index).split(/[\r\n;|<>"']/)[0].slice(0,170);
      const house=rest.match(/^[^\r\n;|<>"']{3,90}?(?:,\s*|\s+)(?:n[º°o.]?\s*)?(?:\d{1,6}\b|s\/?n\b)/i);
      if (!house) continue;
      let end=rest.length;
      const sentence=rest.slice(house[0].length).search(/\.\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/u);
      if (sentence!==-1) end=Math.min(end,house[0].length+sentence);
      const value=rest.slice(0,end).trimEnd().replace(/[.,]+$/,'');
      addHit(m.index,m.index+value.length,'Endereços','Rua Exemplo, 000 - Bairro Exemplo, Cidade/UF',68);
    }
    // A standalone formatted CEP, or an unformatted CEP with an explicit label.
    add(/(?<!\d)\d{5}-\d{3}(?!\d)/g,'CEPs','00000-000',35);
    for(const m of input.matchAll(/\bCEP\s*[:=#-]?\s*(\d{8})(?!\d)/gi)) {
      const value=m[1], start=m.index+m[0].lastIndexOf(value);
      addHit(start,start+value.length,'CEPs','00000000',35);
    }
  }
  if(settings.ip) add(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,'Endereços IP','192.0.2.1',15);
  if(settings.uuid) add(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,'UUIDs','00000000-0000-4000-8000-000000000000',10);

  const accepted = resolveOverlaps(candidates);
  let text='',pos=0;
  for(const h of accepted){text+=input.slice(pos,h.start)+h.replacement;pos=h.end;}
  text+=input.slice(pos);
  return {text,hits:accepted};
}
