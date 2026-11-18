"""Rule-based detection for the optional, local PDF redactor.

The browser detector lives in src/sanitize.js. When adding a new rule, update both
engines and their tests. This module reports character offsets only; no data is sent
or logged. Rule-based recognition is NOT a completeness guarantee.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Hit:
    start: int
    end: int
    category: str
    priority: int


DETECTORS = (
    "assignments", "bearer", "privateKeys", "urlCredentials", "tokens",
    "jwt", "cpf", "cnpj", "emails", "phones", "addresses", "ip", "uuid",
)

SENSITIVE_KEY = re.compile(
    r"(?:api(?:key|token)|(?:key|token)api|(?:access|refresh|auth|id)token|"
    r"(?:client|private|service(?:role)?)key|clientsecret|"
    r"password|passwd|pwd|secret|credential|token|authorization|"
    r"(?:database|db|postgres|mysql|redis|mongo)(?:url|uri|pass|password|token|secret)|"
    r"connection(?:string|url))", re.I,
)
IGNORABLE_SUFFIX = re.compile(r"(?:count|length|size|limit|timeout|enabled|expires|type|name|label|prefix|placeholder|example)$", re.I)
ASSIGNMENT = re.compile(
    r"(?:^|[\s,{;])[^\S\r\n]*(?:(?:export|const|let|var)\s+)?"
    r"([\"']?)([A-Za-z][\w.-]{0,100})\1\s*[:=]\s*"
    r"(\"(?:\\.|[^\"\r\n])*\"|'(?:\\.|[^'\r\n])*'|`[^`\r\n]*`|[^\s,;}#\r\n]+)"
    r"(?=[\s,;}#]|$)", re.M,
)


def _sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[-_.]", "", key).lower()
    return bool(SENSITIVE_KEY.search(normalized) and not IGNORABLE_SUFFIX.search(key))


def _valid_cnpj(s: str) -> bool:
    if len(s) != 14 or len(set(s)) == 1:
        return False
    for end, weights in [(12, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)),
                         (13, (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))]:
        total = sum(int(d) * w for d, w in zip(s[:end], weights))
        expected = 0 if total % 11 < 2 else 11 - total % 11
        if int(s[end]) != expected:
            return False
    return True


def detect(text: str, enabled: dict[str, bool] | None = None) -> list[Hit]:
    """Return accepted, non-overlapping [start, end) character spans."""
    settings = {key: True for key in DETECTORS}
    if enabled:
        settings.update(enabled)
    candidates: list[Hit] = []

    def append(start: int, end: int, category: str, priority: int) -> None:
        if end > start:
            candidates.append(Hit(start, end, category, priority))

    def matches(pattern: str, key: str, category: str, priority: int, flags: int = 0, group: int = 0):
        if settings[key]:
            for m in re.finditer(pattern, text, flags):
                append(*m.span(group), category, priority)

    if settings["assignments"]:
        pos = 0
        while (m := ASSIGNMENT.search(text, pos)) is not None:
            # A benign field ("Erro: apitoken=SECRET") must not consume a
            # nested sensitive assignment on the same line.
            pos = m.end() if _sensitive_key(m.group(2)) else m.start() + 1
            if not _sensitive_key(m.group(2)):
                continue
            raw = m.group(3)
            if m.group(2).lower() == "authorization" and raw.lower() == "bearer":
                continue
            quote = len(raw) > 1 and raw[0] in "\"'`" and raw[-1] == raw[0]
            value = raw[1:-1] if quote else raw
            if not value or value.lower() in {"null", "undefined", "none", "true", "false"}:
                continue
            start, end = m.span(3)
            append(start + int(quote), end - int(quote), "Credenciais", 110)

    matches(r"-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----", "privateKeys", "Chaves privadas", 100)
    matches(r"\bBearer\s+[^\s\"'`,;}{]{6,}", "bearer", "Bearer", 90, re.I)
    matches(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|https?|ftp)://[^\s/@:'\"<>]+(?::[^\s/@'\"<>]*)?@", "urlCredentials", "Credenciais em URL", 85, re.I)
    matches(r"\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\b", "jwt", "JWT", 85)
    matches(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{25,})\b", "tokens", "Tokens conhecidos", 80)
    matches(r"(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)", "cpf", "CPF", 65)
    matches(r"(?<!\d)\d{3} \d{3} \d{3}[ -]\d{2}(?!\d)", "cpf", "CPF", 65)
    if settings['cpf']:
        for m in re.finditer(r"(?<!\d)\d{11}(?!\d)", text):
            before = text[max(0, m.start() - 45):m.start()]
            if re.search(r"\b(?:telefone|tel\.?|celular|cel\.?|whatsapp|whats|fone|phone|mobile|contato)\s*[:=#-]\s*$", before, re.I):
                continue
            append(*m.span(), "CPF / 11 dígitos", 60)
    matches(r"(?<!\d)\d{2}[. ]\d{3}[. ]\d{3}[/ ]\d{4}[- ]\d{2}(?!\d)", "cnpj", "CNPJ", 40)
    if settings["cnpj"]:
        for m in re.finditer(r"(?<!\d)\d{14}(?!\d)", text):
            before = text[max(0, m.start()-32):m.start()]
            if _valid_cnpj(m.group()) or re.search(r"\bcnpj\s*[:=#-]?\s*$", before, re.I):
                append(*m.span(), "CNPJ", 38)
    matches(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "emails", "E-mail", 30, re.I)
    if settings["phones"]:
        phone_label = re.compile(r"\b(?:telefone|tel\.?|celular|cel\.?|whatsapp|whats|fone|phone|mobile|contato)\s*[:=#-]\s*$", re.I)
        cpf_label = re.compile(r"\bcpf\s*[:=#-]?\s*$", re.I)
        for m in re.finditer(r"(?<!\d)(?:\+55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)", text):
            before = text[max(0,m.start()-45):m.start()]
            if cpf_label.search(before):
                continue
            digits=re.sub(r"\D", "", m.group())
            formatted=bool(re.search(r"[()+.\s-]",m.group()))
            if len(digits)==10 and not formatted and not phone_label.search(before):
                continue
            priority=20 if not formatted and not phone_label.search(before) else 75
            append(*m.span(), "Telefone", priority)
        for m in re.finditer(r"(?<!\d)(?:9\d{4}|[2-8]\d{3})[\s.-]?\d{4}(?!\d)", text):
            before=text[max(0,m.start()-45):m.start()]
            if cpf_label.search(before) or (not phone_label.search(before) and not re.search(r"[-.\s]",m.group())):
                continue
            append(*m.span(), "Telefone", 50)
        matches(r"(?<!\d)0800[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)", "phones", "Telefone", 55)

    if settings["addresses"]:
        labeled=re.compile(r'''(?<![\w])(?:endere[cç]o(?:\s+(?:residencial|comercial|de\s+entrega))?|logradouro|address)["']?\s*[:=]\s*(?:"([^"\r\n]{5,200})"|'([^'\r\n]{5,200})'|([^\r\n;|<>"']{5,200}))''', re.I)
        for m in labeled.finditer(text):
            value=next((g for g in m.groups() if g is not None), '')
            if re.fullmatch(r"(?:n[ãa]o\s+informado|n/?a|nenhum|sem\s+endere[cç]o|null|undefined|-+)", value.strip(),re.I):
                continue
            start=m.start()+m.group().rfind(value)
            append(start,start+len(value.rstrip()),"Endereço",70)
        street=re.compile(r'''(?<![\w])(?:Rua|R\.|Avenida|Av\.|Travessa|Tv\.|Alameda|Estrada|Rodovia|Pra[cç]a|Servid[ãa]o|Largo|Beco|Passagem)\s+''',re.I)
        house=re.compile(r'''^[^\r\n;|<>"']{3,90}?(?:,\s*|\s+)(?:n[º°o.]?\s*)?(?:\d{1,6}\b|s/?n\b)''',re.I)
        for m in street.finditer(text):
            rest=re.split(r'''[\r\n;|<>"']''', text[m.start():],maxsplit=1)[0][:170]
            h=house.match(rest)
            if not h: continue
            end=len(rest)
            sentence=re.search(r"\.\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])",rest[len(h.group()):])
            if sentence: end=min(end,len(h.group())+sentence.start())
            value=rest[:end].rstrip().rstrip('.,')
            append(m.start(),m.start()+len(value),"Endereço",68)
        matches(r"(?<!\d)\d{5}-\d{3}(?!\d)", "addresses", "CEP", 35)
        for m in re.finditer(r"\bCEP\s*[:=#-]?\s*(\d{8})(?!\d)",text,re.I):
            append(*m.span(1),"CEP",35)
    matches(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b", "ip", "IPv4", 15)
    matches(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", "uuid", "UUID", 10, re.I)

    candidates.sort(key=lambda h: (-h.priority, -(h.end - h.start), h.start))
    selected: list[Hit] = []
    for candidate in candidates:
        if not any(candidate.start < other.end and candidate.end > other.start for other in selected):
            selected.append(candidate)
    return sorted(selected, key=lambda h: h.start)
