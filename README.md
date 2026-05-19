# textcrawlergame

터미널에서 동작하는 텍스트 기반 TCG + RPG 던전 크롤러.

## 핵심 컨셉

- **카드 자체를 파밍·강화하는 던전 크롤러.** 슬더스가 "이번 런의 덱을 빌드"한다면, 이 게임은 "차원 창고의 카드 자산을 키워나가는" 게임.
- **카드 인스턴스 모델**: 같은 "단검투척"이라도 사본마다 다른 강화가 누적된다.
- **차원 창고 (Shared Inventory)**: 캐릭터가 죽어도 보관한 카드와 골드는 모든 슬롯이 공유한다.
- **그리드 맵 탐험**: 인접 4칸만 보이고, 이동한 엣지는 소비된다.
- **패시브 메타 진행**: 최종보스를 클리어하면 보유 스킬 중 하나를 모든 캐릭터에 영구 적용.

## 설치

```
npm install -g textcrawlergame
```

## 실행

```
crtgame
```

## 개발 상태

**Phase 1: 아키텍처 설계 진행 중.**
구현 전 설계 문서는 `docs/architecture/` 참조.

| 단계 | 상태 |
|---|---|
| Phase 1 — 아키텍처 설계 문서 | 진행 중 |
| Phase 2 — 엔진 + 데이터 파이프라인 골격 | 미시작 |
| Phase 3 — UI (Ink) + 저장 시스템 | 미시작 |
| Phase 4 — 콘텐츠 작성 스킬 | 미시작 |
| Phase 5 — 콘텐츠 채우기 | 미시작 |

## 폴더 구조

```
textcrawlergame/
├── src/                  # TypeScript 소스 (엔진/UI/데이터 로더)
│   └── data/
│       └── generated/    # authoring/ 에서 빌드된 JSON (gitignore X, 커밋함)
├── authoring/            # 디자이너용 콘텐츠 소스 (xlsx/yaml)
├── scripts/              # 빌드 스크립트 (data 파이프라인 등)
└── docs/
    └── architecture/     # 설계 문서 (이 단계)
```
