# 데이터: TypeScript → Excel 마이그레이션 트래커

## 목적

Phase 2 초기 개발 단계에서는 모든 콘텐츠 데이터를 **TypeScript 모듈** 로 인라인 정의한다 (`src/data/dummy/*.ts`). 빠른 피드백 루프를 위해. 콘텐츠가 폭발하기 시작하는 Phase 4 직전에 **Excel 파이프라인** 으로 전환한다 (`07_save_and_data_pipeline.md` 참조).

이 문서는 **그 전환에서 어떤 것도 빠지지 않도록** 모든 TS 모듈과 그 시트 매핑을 기록한다.

## 갱신 규칙

새 데이터 모듈을 추가할 때마다:
1. 아래 매핑 테이블에 1행 추가
2. 시트 컬럼 스키마를 "Excel 시트 스키마" 섹션에 기입
3. 특이 사항(중첩 구조, 동적 풀, 변수 치환 등)은 "특이 사항" 에 메모

상태 컬럼:
- 🟡 TS 정의됨 (마이그레이션 대상)
- 🟢 Excel 마이그레이션 완료 + JSON 빌드됨
- 🔴 마이그레이션 중 (스키마 검증 실패 등)

## 매핑 테이블

| TS 모듈 (`src/data/dummy/`) | 도메인 | 대상 Excel 파일 | 시트 이름 | 상태 | 비고 |
|---|---|---|---|---|---|
| (없음 — 다음 단계에서 추가 시작) | | | | | |

## Excel 시트 스키마

(TS 모듈 추가 시점에 채워나감)

### `cards.xlsx` — Cards 시트 (예정)

| 컬럼 | 타입 | 필수 | 비고 |
|---|---|---|---|
| id | string | Y | snake_case, unique |
| name | string | Y | 한국어 허용 |
| cost | number 또는 'X' | Y | 음수 불허 |
| type | enum | Y | attack/skill/power/curse/status |
| target | enum | Y | none/self/enemy/allEnemies/randomEnemy |
| rarity | enum | Y | starter/common/uncommon/rare/special |
| tags | string (csv) | N | 콤마 구분 |
| keywords | string (csv) | N | exhaust/retain/ethereal/innate/unplayable |
| baseDescription | string | Y | `{var}` 치환 |
| baseEffects | JSON string | Y | Effect[] |
| modifierPoolRefs | string (csv) | N | 풀 ID 콤마 구분 |
| maxModifiers | number | N | 빈 셀이면 무제한 |

### `modifiers.xlsx` — Modifiers 시트 (예정)

| 컬럼 | 타입 | 필수 | 비고 |
|---|---|---|---|
| id | string | Y | snake_case |
| name | string | Y | |
| weight | number | Y | 기본 풀 가중치 |
| tags | string (csv) | N | |
| conflictsWith | string (csv) | N | modifier ID 목록 |
| requires | string (csv) | N | |
| transforms | JSON string | N | 빈 셀 + customHandlerId 있으면 코드 모드 |
| descriptionTemplate | string | Y | |
| customHandlerId | string | N | 코드 모드일 때만 |

### `modifier_pools.xlsx` — ModifierPools 시트 (예정)

행마다 한 풀의 한 엔트리.

| 컬럼 | 타입 | 필수 | 비고 |
|---|---|---|---|
| poolId | string | Y | 같은 풀의 행들끼리 그룹핑 |
| poolName | string | Y | 첫 행에만 있어도 됨 |
| modifierId | string | Y | |
| weight | number | Y | 이 풀에서의 가중치 (Modifier.weight override) |
| conditional | JSON string | N | PoolCondition |

### `card_pools.xlsx` — CardPools 시트 (예정)

(modifier_pools와 동일 구조, modifierId 대신 cardDefId)

### `statuses.xlsx` — Statuses 시트 (예정)

(아직 미설계 — 추가 시 기입)

### `enemies.xlsx` — Enemies 시트 (예정)

(아직 미설계)

### `enemy_groups.xlsx` — EnemyGroups 시트 (예정)

(아직 미설계)

### `skills.xlsx` — Skills 시트 (예정)

(아직 미설계)

## 특이 사항 (Excel로 옮길 때 주의)

### 1. 중첩/계층 데이터

다음은 Excel로 옮기기 부적합 → YAML 유지:

- **EventDefinition + FlowDefinition** (이벤트와 플로우) — `authoring/events/<id>.yaml`
- **시나리오 템플릿** — `authoring/events/scenarios/<id>.yaml`
- **난이도 테이블** — `authoring/difficulty/difficulty_table.yaml` (특수 버프 배열 때문)
- **스킬 박스 정의** — `authoring/economy/skill_boxes.yaml`
- **경제 데이터** — `authoring/economy/*.yaml`

### 2. 동적 풀 (`__inventory_dynamic__` 등)

특수 풀 ID는 런타임에만 의미. 데이터 파일에는 등장하지 않고, FlowStep의 poolId 필드에 `__inventory_dynamic__` 같은 magic string으로 박힘. 파서는 이를 별도 처리.

### 3. 변수 치환 (`{playerName}`, `$stacks` 등)

TS 모듈에서는 단순 문자열. Excel에서도 마찬가지 — 렌더링 시점에 치환되므로 데이터에는 그대로 둠.

### 4. UUID 사용 인스턴스 데이터

CardInstance 등은 **데이터가 아니라 세이브 객체**. 마이그레이션 대상 아님. 콘텐츠 데이터(Definition)만 Excel.

### 5. `customHandlerId` 가 가리키는 코드 파일

핸들러 코드는 `src/engine/modifiers/handlers/*.ts` 등에 위치. 데이터에는 ID만 등장. Excel 셀에는 핸들러 코드를 못 적음 — 코드 변경 시 코드 파일에 같이 작업해야 함을 명시.

### 6. JSON 셀의 가독성

`baseEffects`, `transforms` 등이 JSON 문자열로 들어가면 디자이너가 읽기 어려움. 대안 (Phase 4에서 결정):
- (a) JSON 그대로 (단순)
- (b) effects.xlsx 별도 시트에 effect ID 정의, cards에서 ID 참조 (정규화)
- (c) 한 효과당 한 컬럼 (예: damage_amount, damage_target, gain_block, ...) — 효과가 늘면 컬럼 폭발
- (d) YAML inline 셀 (xlsx는 멀티라인 셀 지원)

권장: (a) 시작 + 디자이너 피드백 → (b) 또는 (d) 전환.

## 마이그레이션 체크리스트 (Phase 4 진입 시)

- [ ] `scripts/build-data.ts` 작성 (xlsx + yaml 읽고 JSON 출력)
- [ ] 각 시트마다 Zod 스키마 매핑 함수
- [ ] 교차 참조 검증 통과
- [ ] 모든 TS dummy 모듈을 xlsx 시트로 행 1:1 변환 (수동 또는 변환 스크립트)
- [ ] 변환 후 `src/data/generated/*.json` 이 TS 모듈과 deep-equal 한지 테스트
- [ ] 기존 import 경로 (`from '@/data/dummy/cards'`) → (`from '@/data/generated/cards.json'`) 일괄 변경
- [ ] dummy 모듈 폴더 삭제 (또는 archive)
- [ ] CI에 `npm run build:data` 추가
- [ ] 디자이너에게 xlsx 작성법 가이드 전달

## 변경 로그

| 날짜 | 변경 |
|---|---|
| 2026-05-19 | 문서 초안 작성. TS 모듈 0개. |
