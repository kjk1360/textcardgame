# 00. 아키텍처 개요

## 게임 정체성 (Design Pillars)

이 게임의 정체성은 다음 5개 기둥으로 정의된다. 모든 시스템 설계는 이 기둥에 부합해야 한다.

1. **카드 자산 파밍.** 핵심 루프는 "강해지는 카드를 모은다" 이지 "이번 런을 이긴다"가 아니다. 슬더스의 단발성 빌드 게임이 아니라, 카드를 **차원 창고에 누적**시키는 메타 진행 게임.
2. **카드는 정의가 아니라 인스턴스.** 같은 "단검투척"이라도 사본마다 강화가 다르다. 카드 1장 = 강화 누적의 컨테이너.
3. **메타 진행 vs 캐릭터 수명.** 캐릭터(스킬·골드 운용 주체)는 죽으면 사라진다. 카드·골드·해금된 패시브는 영구.
4. **그리드 탐험형 던전.** 슬더스의 선형 DAG가 아니라, 인접 4칸 가시·엣지 소비 방식의 진짜 크롤러. 길을 잃을 수 있고, 막히면 엘리트가 길을 뚫어준다.
5. **데이터 기반 콘텐츠 확장.** 카드/적/유물/이벤트/모디파이어는 모두 데이터. 신규 콘텐츠 추가에 코드 수정 거의 불필요.

## 아키텍처 레이어

```
┌─────────────────────────────────────────────────────┐
│ Authoring Layer  (디자이너용, 사람이 작성)          │
│  authoring/*.xlsx, authoring/events/*.yaml          │
└──────────────────────┬──────────────────────────────┘
                       │ build-data.ts (Zod 검증 + 변환)
                       ▼
┌─────────────────────────────────────────────────────┐
│ Data Layer  (런타임, 자동 생성·커밋됨)              │
│  src/data/generated/*.json                          │
│  로더: 부팅 시 검증 + 레지스트리 인덱싱              │
└──────────────────────┬──────────────────────────────┘
                       │ Registries (cards, enemies, …)
                       ▼
┌─────────────────────────────────────────────────────┐
│ Engine Layer  (순수 로직, UI 무관)                   │
│  - CombatEngine, EffectExecutor                      │
│  - ModifierResolver, CardInstance ops                │
│  - MapGenerator, MapNavigator                        │
│  - FlowRuntime, ConditionEvaluator                   │
│  - SaveStore, MetaProgressionService                 │
│  ▶ 모든 상태 변경은 reducer 또는 명시적 service 호출 │
└──────────────────────┬──────────────────────────────┘
                       │ State snapshots + Actions
                       ▼
┌─────────────────────────────────────────────────────┐
│ UI Layer  (Ink — React for CLI)                      │
│  - SplitPane, FocusList, Panel                       │
│  - Screen 컴포넌트 (Title/Map/Combat/Shop/...)       │
│  - 키 입력 → Engine Action 디스패치                  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Skill Layer  (Claude 스킬, 콘텐츠 작성 자동화)      │
│  /crt_card, /crt_event, /crt_pool, /crt_enemy, ...  │
│  → authoring/ 의 .xlsx/.yaml 행/파일을 추가·수정    │
└─────────────────────────────────────────────────────┘
```

**핵심 단방향 의존성**: UI → Engine → Data. Engine은 UI를 모른다. Data는 Engine을 모른다. 이게 깨지면 SOLID 위반.

## SOLID 적용 지점

| 원칙 | 적용 |
|---|---|
| **S**ingle Responsibility | `CombatEngine` 은 전투만 안다. 맵·세이브·이벤트는 모름. `ModifierResolver` 는 모디파이어 합성만, 카드 실행은 모름. |
| **O**pen/Closed | 새 Effect 타입 = 새 핸들러 등록(`EffectExecutor.register`). 코어 수정 X. 새 FlowStep, 새 Modifier Op도 동일. |
| **L**iskov | 모든 Effect는 `Effect` 유니온 타입의 멤버. 모든 FlowStep도 마찬가지. 디스패처 입장에서 안전하게 치환 가능. |
| **I**nterface Segregation | UI는 `EngineSnapshot` + `Action` 두 인터페이스만 본다. 내부 구현 노출 X. |
| **D**ependency Inversion | `EffectExecutor` 는 `IRandom`, `ICardRegistry`, `IInventory` 같은 인터페이스에만 의존. 테스트 시 모킹 가능. |

## 핵심 용어집

| 용어 | 정의 |
|---|---|
| **CardDefinition** | 카드 원형. 불변 데이터. (예: "단검투척"의 베이스 스펙) |
| **CardInstance** | 실제 게임 내 카드 한 장. `defId` + 누적 모디파이어. 고유 `instanceId`. |
| **Modifier** | 카드 효과를 변형하는 데이터 단위. ("+5 피해", "단일→전체") |
| **ModifierInstance** | 카드 인스턴스에 부착된 모디파이어. (인스턴스에 박힌 시점의 modifier id 참조 + 부착 시 메타) |
| **ModifierPool** | 가중치 모디파이어 묶음. 강화 시 샘플링 대상. |
| **Effect** | 게임 상태를 바꾸는 원자 단위. (damage, gainBlock, applyStatus, draw, ...) |
| **Status** | 캐릭터/적에 붙는 상태 효과. (취약, 출혈, 근력, ...) |
| **Skill** | 캐릭터 귀속 패시브. 슬더스의 유물과 유사. 캐릭터 사망 시 소멸. |
| **PassiveSkill** | 최종보스 보상으로 해금된 영구 패시브. 모든 슬롯 공유. |
| **EventNode** | 맵 위의 노드 하나. 클리어 시 Flow를 실행. |
| **Flow** | 이벤트의 진행 시나리오. FlowStep 시퀀스. |
| **FlowStep** | Flow의 원자 단위. (대사, 선택지, 카드 제안, 강화, ...) |
| **Scenario** | 재사용 가능한 Flow 템플릿. |
| **Run** | 한 차원문 입장 ~ 휴식처 복귀(또는 사망)까지의 1회 탐험. |
| **Slot** | 캐릭터 슬롯. 최대 5개. 캐릭터 1명에 1슬롯. |
| **Global** | 모든 슬롯이 공유하는 메타 상태. (골드, 인벤토리, 패시브, 통계) |
| **Dimensional Warehouse (차원 창고)** | Global 인벤토리. 보관된 카드 인스턴스가 강화 그대로 살아있음. |
| **Rest Hub (휴식처)** | 던전과 던전 사이의 메뉴 공간. 인벤·판매·차원문 탐사. |
| **Difficulty Level** | 휴식처 복귀 시마다 +1. 적 버프 데이터 테이블에 따라 강화. 캐릭터당 카운터. |

## 상위 상태 머신 (요약)

세부는 `08_phase_and_state_machine.md` 참조.

```
        ┌────────────┐
        │   Title    │ (슬롯 5개 선택)
        └─────┬──────┘
              │
       ┌──────┴──────┐
       ▼             ▼
 [New Slot]    [Existing Slot]
       │             │
       │      ┌──────┴───────┐
       │      ▼              ▼
       │  [At Rest]    [Mid-Run]
       │      │              │
       │      ▼              │
       ▼  Rest Hub Menu      │
  Initial Start Phase ◀──────┘ (Explore 선택 시)
       │
       ▼
   Map (Dungeon)
       │
       ├─ Combat / Event / Shop / ...
       │
       ▼
   Run End (휴식처 복귀 OR 사망)
       │
       ├─ 복귀 → 난이도 +1 → Rest Hub Menu
       └─ 사망 → 슬롯 데이터 삭제 → Title
```

## 문서 인덱스

| 번호 | 문서 | 핵심 내용 |
|---|---|---|
| 00 | overview | 이 문서 |
| 01 | engine_primitives | 모든 게임 명사의 TypeScript 타입 정의 |
| 02 | card_and_modifier_system | 카드 인스턴스 + 모디파이어 합성 (게임의 심장) |
| 03 | combat_system | 전투 루프, 효과 파이프라인, 상태 효과 |
| 04 | event_flow_system | 이벤트/플로우 런타임, 분기, 조건 |
| 05 | map_system | 그리드 맵, 엣지 소비, 막힘 해소 |
| 06 | meta_progression | 골드/인벤/패시브/난이도/최종보스 |
| 07 | save_and_data_pipeline | 세이브 스키마 + Excel/YAML → JSON 빌드 |
| 08 | phase_and_state_machine | 게임 전체 상태 머신 + 휴식처 메뉴 |
| 09 | skill_authoring | `/crt_*` 콘텐츠 작성 스킬 명세 |

## 비목표 (Non-goals)

명시적으로 하지 않는 것들:

- **그래픽 카드/이미지.** 텍스트만.
- **마우스 입력.** 키보드 전용 (방향키 + Enter + Esc).
- **온라인/멀티플레이.** 100% 로컬, 100% 싱글.
- **모드 시스템 (1.0).** 데이터 분리는 모드를 가능케 하지만, 모드 로더는 v1 범위가 아님.
- **언어 다중화.** 일단 한국어. i18n은 데이터 스키마에 필드를 분리해두는 정도만.
