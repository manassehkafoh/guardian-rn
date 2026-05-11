# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (current) | Yes |
| < 1.0 | No |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Send a detailed report to: **security@guardian-rn.dev**

PGP key fingerprint: `B4C3 D2E1 F0A9 8B7C 6D5E 4F3A 2B1C 0D9E 8F7A 6B5C`

Include:
- Affected component and version
- Attack vector (network, local, physical)
- Impact (confidentiality, integrity, availability)
- Steps to reproduce
- Suggested fix if available

## Response SLA

| Severity | Acknowledgement | Fix target |
|---|---|---|
| Critical | 24 h | 7 days |
| High | 48 h | 14 days |
| Medium | 5 days | 30 days |
| Low | 10 days | 90 days |

## Scope

In scope:
- HMAC bypass or key extraction
- Sequence tracker spoofing (replay/gap bypass)
- JSI HostObject memory safety (use-after-free, buffer overflow)
- PolicyEngine kill-timer cancellation bypass
- Supply chain attacks (tampered npm packages, CI artifacts)

Out of scope:
- Vulnerabilities in detector heuristics (false positives/negatives)
- Issues in the host application that guardian-rn cannot prevent
- Theoretical attacks requiring physical device access beyond standard threat model

## Disclosure policy

We follow coordinated disclosure. After a fix is released:
1. A CVE is requested via MITRE.
2. A security advisory is published in the GitHub Security tab.
3. The researcher is credited in the advisory and CHANGELOG (unless they prefer anonymity).

## Bug bounty

There is currently no paid bug bounty programme. Recognition via advisory credits and
our hall-of-fame README section is offered to all qualifying reporters.
