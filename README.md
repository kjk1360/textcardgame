# ccgame

터미널에서 동작하는 텍스트 기반 TCG + RPG 던전 크롤러.

## 핵심 컨셉

- **카드 자체를 파밍·강화하는 던전 크롤러.** 슬더스가 "이번 런의 덱을 빌드"한다면, 이 게임은 "차원 창고의 카드 자산을 키워나가는" 게임.
- **카드 인스턴스 모델**: 같은 "단검투척"이라도 사본마다 다른 강화가 누적된다.
- **차원 창고 (Shared Inventory)**: 캐릭터가 죽어도 보관한 카드와 골드는 모든 슬롯이 공유한다.
- **그리드 맵 탐험**: 인접 4칸만 보이고, 이동한 엣지는 소비된다.
- **패시브 메타 진행**: 최종보스를 클리어하면 보유 스킬 중 하나를 모든 캐릭터에 영구 적용.

## 설치

Node.js 20 이상 필요.

```sh
npm install -g ccgame
```

## 실행

설치 후 어디서나:

```sh
ccgame
```

기타 명령:

```sh
ccgame --version   # 설치된 버전 확인
ccgame --help      # 사용법
```

## 업데이트

게임 시작 시 npm 레지스트리를 (하루 1회 캐시) 확인해서 새 버전이 있으면 안내가 뜹니다. 실제로 받아오려면:

```sh
npm install -g ccgame@latest
```

## 개발

저장소를 직접 클론해서 돌리려면:

```sh
git clone https://github.com/kjk1360/textcardgame.git
cd textcardgame
npm install
npm run dev          # tsx로 src/cli.tsx 직접 실행
npm test             # 전체 테스트
npm run dump         # 등록된 카드/풀/이벤트 dump
npm run build        # dist/ 빌드 (publish용)
```

## 폴더 구조

```
ccgame/
├── src/
│   ├── cli.tsx              # 진입점 (bin = ccgame)
│   ├── ui/                  # Ink/React 화면
│   ├── engine/              # 전투·플로우·맵·상태 엔진
│   ├── data/                # 카드/스킬/이벤트 정의 (카테고리별 파일)
│   └── scripts/dump.ts      # 컨텐츠 dump CLI
├── scripts/postbuild.mjs    # tsc 후 셔뱅 복원
├── docs/architecture/       # 설계 문서
└── package.json
```

## 라이선스

MIT
