# 09. 콘텐츠 작성 스킬 (`/crt_*`)

게임의 콘텐츠(카드/이벤트/적/...)를 자연어 → 데이터로 자동 변환하는 Claude 스킬들의 명세.

## 스킬의 역할

각 `/crt_*` 스킬은 다음을 자동화한다:
1. 사용자 자연어 설명 수신
2. 필요한 구조화 정보 인터뷰 (부족한 부분만)
3. 데이터 파일 작성 또는 수정 (`authoring/`)
4. 교차 참조 검증 — 누락 의존성 발견 시 다른 `/crt_*` 안내
5. `npm run build:data` 실행 → 빌드 통과 확인
6. 결과 요약

**모든 스킬은 `docs/architecture/` 의 스키마를 단일 진실 공급원으로 사용한다.**

## 스킬 목록

| 스킬 | 작성 대상 | 출력 |
|---|---|---|
| `/crt_card` | 카드 1장 (CardDefinition) | `authoring/cards.xlsx` 행 추가/수정 |
| `/crt_modifier` | 모디파이어 1개 | `authoring/modifiers.xlsx` 행 |
| `/crt_modifier_pool` | 모디파이어 풀 | `authoring/modifier_pools.xlsx` 행들 |
| `/crt_card_pool` | 카드 풀 | `authoring/card_pools.xlsx` 행들 |
| `/crt_status` | 상태 효과 | `authoring/statuses.xlsx` 행 |
| `/crt_enemy` | 적 1마리 | `authoring/enemies.xlsx` 행 |
| `/crt_enemy_group` | 적 인카운터 그룹 | `authoring/enemy_groups.xlsx` 행 |
| `/crt_skill` | 스킬 1개 | `authoring/skills.xlsx` 행 |
| `/crt_event` | 이벤트 1개 (+ Flow) | `authoring/events/<id>.yaml` 파일 |
| `/crt_scenario` | 재사용 Flow 시나리오 | `authoring/events/scenarios/<id>.yaml` |
| `/crt_difficulty` | 난이도 테이블 행 추가 | `authoring/difficulty/difficulty_table.yaml` |
| `/crt_skillbox` | 스킬 박스 정의 변경 | `authoring/economy/skill_boxes.yaml` |
| `/crt_economy` | 경제 데이터 (판매가/용량업글) | `authoring/economy/*.yaml` |

## 공통 인터뷰 흐름

```
사용자: /crt_card  단검을 빠르게 두 번 던지는 카드 만들어줘

스킬:
  1. 자연어 설명 분석 → 초안 추출:
     - 이름: ?  → "이중 단검투척"으로 제안
     - 비용: ? → 슬더스 관행 1
     - 타입: attack
     - 타겟: enemy
     - 효과: damage(?, ?) × 2 hits
  2. 부족한 정보 인터뷰:
     - 데미지 수치?
     - 희귀도?
     - 어떤 모디파이어 풀에 속해야 하나? (단검 풀 있음 → 자동 제안)
     - tags?
  3. 작성:
     - authoring/cards.xlsx 의 마지막 행에 새 row append
  4. 검증: npm run build:data
  5. 결과 보고 + diff 미리보기
```

## `/crt_card` 명세

### 입력
- 자연어 설명 (필수)
- 선택적 명시 필드 (이름, 비용, ...)

### 출력
- `authoring/cards.xlsx` 행 1개 (신규) 또는 수정

### 인터뷰 슬롯

| 슬롯 | 필수 | 기본값/추론 |
|---|---|---|
| id | Y | 이름 영문 변환 + snake_case |
| name | Y | 자연어에서 추출 |
| cost | Y | attack/skill 1, power 2 (관행) |
| type | Y | 효과 분석으로 추론 |
| target | Y | 효과 분석 (damage → enemy 등) |
| rarity | Y | 효과 강도로 추론, 디자이너 확인 |
| tags | N | 사용자 명시 또는 기존 카드의 태그 컨벤션 |
| keywords | N | 사용자 명시 (exhaust 등) |
| baseDescription | Y | `{var}` 포함 템플릿 자동 생성 |
| baseEffects | Y | 효과 분석으로 구조화 |
| modifierPoolRefs | N | tags 매칭으로 자동 제안 |

### 검증 후 의존성 누락 시

```
사용자: /crt_card  화염구 — 적에게 8 피해 + 화상 3
스킬:
  ⚠ 'burn' (화상) 상태 효과가 정의되지 않았습니다.
  → /crt_status 를 먼저 실행해 'burn' 을 만들어주세요.
  또는 자동으로 임시 정의를 만들어드릴까요? (사용자 확인)
```

## `/crt_event` 명세

가장 복잡한 스킬. 이벤트는 계층 구조라 다단계 인터뷰가 필요.

### 입력 예시 (사용자의 원래 시나리오)

```
/crt_event
모든 새로 시작하는 슬롯(캐릭터)은 첫 시작 노드에서
"여정의 시작" 이벤트 노드를 만나고, 해당 이벤트는
[Start_Card_Select_Group] 카드풀에서 카드풀 내부 가중치를
기준으로 3개의 선택지가 5번 제시되고, 여기서 선택한
카드로 시작 덱을 구성한 다음 이벤트가 종료된다.
플로우는 [시나리오_12번] 플로우를 따른다.
```

### 스킬의 처리

1. **구조 파싱**
   - 이벤트 ID: `journey_start` (이름 기반)
   - 노드 타입: 시작 트리거형 → `event_trigger`
   - 플로우: 사용자가 명시 (`scenario_12`) → 기존 시나리오 참조
   - 플로우 내용: 사용자가 카드 풀 정보를 줬음 → flow 자동 작성 가능

2. **의존성 확인**
   - `Start_Card_Select_Group` → `pool_start_cards` 로 매핑 제안
     - 없으면: `/crt_card_pool` 안내
   - `시나리오_12번` → `scenario_12` 파일 존재 확인
     - 없으면: `/crt_scenario` 안내 또는 inline 생성 제안

3. **인터뷰 (부족분만)**
   - "이 이벤트는 매번 등장? 1회성?" → oneShot 결정
   - "차원 창고 옵션을 추가할까요?" (사용자 원래 디자인 반영)

4. **작성**
   - `authoring/events/journey_start.yaml` 생성
   - 내부에 event + flow 둘 다 정의 (시나리오 참조면 flow 생략)

5. **검증 → 보고**

### `/crt_event` 가 생성하는 YAML 예시

```yaml
event:
  id: journey_start
  name: "여정의 시작"
  nodeType: event_trigger
  flowId: scenario_journey_start
  oneShot: false

flow:
  id: scenario_journey_start
  entryStepId: opening
  steps:
    opening:
      kind: dialogue
      speaker: "차원의 안내자"
      text: "또 한 명의 도전자가 왔군. 너의 첫 무기를 골라야 한다."
      next: card_picks

    card_picks:
      kind: cardOffer
      poolId: pool_start_cards
      picksPerIteration: 3
      iterations: 5
      destination: currentDeck
      next: warehouse_check

    warehouse_check:
      kind: branch
      branches:
        - condition: { kind: hasCardInInventory }
          next: warehouse_offer
      defaultNext: depart

    warehouse_offer:
      kind: choice
      prompt: "차원 창고에서 물건을 살펴보겠는가?"
      options:
        - label: "꺼낸다"
          next: warehouse_take
        - label: "이번 생은 가진 것만으로"
          next: depart

    warehouse_take:
      kind: cardOffer
      poolId: __inventory_dynamic__
      picksPerIteration: 0
      iterations: 1
      destination: currentDeck
      allowSkip: true
      next: depart

    depart:
      kind: dialogue
      text: "행운을 빈다, {playerName}여."
      next: end_node

    end_node:
      kind: end
      outcome: success
```

## `/crt_modifier` 명세

### 입력 예시
```
/crt_modifier  
이 모디파이어는 카드 사용시 방어도 10을 얻는 대신
피해량이 5 줄어든다. 공격 카드에만 붙는다.
```

### 처리
1. 변형 분석:
   - `modifyEffect` on damage: delta -5
   - `appendEffect` gainBlock 10
2. ID 제안: `mod_trade_damage_for_block`
3. tags: `physical` (사용자 확인)
4. weight: 5 (기본)
5. 어느 풀에 넣을지: `pool_attack_generic` 또는 새 풀

### 출력
```yaml
# authoring/modifiers.xlsx 에 행 추가:
id: mod_trade_damage_for_block
name: "방어 자세"
weight: 5
tags: physical
descriptionTemplate: "피해량 5 감소, 방어도 10 획득."
transforms: |
  [
    { "op": "modifyEffect", "match": { "kind": "damage" }, "set": { "amount": { "delta": -5 } } },
    { "op": "appendEffect", "effect": { "kind": "gainBlock", "amount": 10 } }
  ]
```

(xlsx 셀에는 JSON 문자열로 저장)

## `/crt_status` 명세

### 입력
```
/crt_status
화상 — 매 턴 끝마다 N의 진짜 피해를 입히고, 스택이 1씩 줄어든다.
```

### 처리 → 출력
```yaml
id: burn
name: "화상"
description: "턴 끝마다 {stacks}의 진짜 피해를 입고 1 감소."
stackingRule: sum
tickTiming: endOfOwnerTurn
decay: { kind: oneStackPerTrigger }
hooks:
  - on: onTurnEnd
    effects:
      - { kind: loseHp, amount: "$stacks", ignoreBlock: true }
tags: [fire, debuff]
```

(`"$stacks"` 는 런타임 변수 — 효과 실행 시 status.stacks 값으로 치환)

## `/crt_enemy` 명세

### 입력
```
/crt_enemy
이름: 가시도적  HP: 25~30  티어: normal
의도 패턴: 1턴 공격 8, 2턴 방어 6, 3턴 공격 12, 반복
```

### 처리 → 출력 (cycle 모드)
```yaml
id: thorn_thief
name: "가시도적"
tier: normal
hpRange: [25, 30]
intentScript:
  mode: cycle
  intents:
    - id: atk1
      display: { kind: attack, value: 8 }
      effects: [{ kind: damage, amount: 8, target: enemy /*=player*/ }]
    - id: def1
      display: { kind: defend, value: 6 }
      effects: [{ kind: gainBlock, amount: 6 }]
    - id: atk2
      display: { kind: attack, value: 12 }
      effects: [{ kind: damage, amount: 12, target: enemy }]
tags: [physical]
rewards:
  goldRange: [12, 20]
  cardRewardPool: pool_common_drop
  cardRewardCount: 3
```

> NB: 적 의도의 `target: enemy` 는 적 입장에서 enemy = 플레이어. 효과 실행 ctx에서 source 기준 해석.

## `/crt_enemy_group` 명세

여러 적이 한 인카운터에 등장:

```
/crt_enemy_group
보스 인카운터: 가시도적 1마리 + 그림자도둑 2마리. 인트로 대사 있음.
```

```yaml
id: group_thieves_ambush
introText: "그림자에서 도적들이 나타난다."
members:
  - { enemyId: thorn_thief,    position: 0 }
  - { enemyId: shadow_thief,   position: 1 }
  - { enemyId: shadow_thief,   position: 2 }
tier: elite
```

## `/crt_skill` 명세

```
/crt_skill
이름: 빠른 손  등급: low
효과: 매 턴 시작 시 카드 1장 추가 드로우.
```

```yaml
id: skill_quick_hands
name: "빠른 손"
grade: low
description: "매 턴 시작 시 카드 1장 추가 드로우."
tags: [utility]
passiveEligible: true
hooks:
  - on: onTurnStart
    condition: { kind: always }
    effects: [{ kind: draw, count: 1 }]
```

## `/crt_difficulty` 명세

```
/crt_difficulty
Lv 6 차원: HP +60%, 근력 +6, 매 턴 적이 1 회복.
```

```yaml
# difficulty_table.yaml 에 추가:
- level: 6
  enemyHpMultiplier: 1.6
  enemyStrengthBonus: 6
  specialBuffs:
    - { kind: regenPerTurn, amount: 1 }
  description: "재생 차원"
```

## 검증 + 빌드 통합

모든 `/crt_*` 스킬은 작성 후 자동으로:

```bash
npm run build:data
```

빌드 실패 시:
- 어느 검증이 깨졌는지 보고
- 자동 수정 가능한 경우 제안 (예: 누락된 풀 자동 생성?)
- 수동 개입 필요한 경우 사용자에게 다음 `/crt_*` 호출 안내

## 스킬 간 흐름 예시 (대형 콘텐츠 작성)

새 직업 컨셉 "사령술사" 콘텐츠 한 묶음:

```
/crt_status  → '저주' 상태 효과
/crt_modifier → '저주 강화' 모디파이어 5개
/crt_modifier_pool → 'pool_curse' 만들기
/crt_card    → 사령술 카드 10장 (각각 pool_curse 연결)
/crt_card_pool → 'pool_curse_rewards' (전투 보상용)
/crt_enemy   → 사령술 관련 적 5마리
/crt_enemy_group → 사령술사 인카운터 그룹 3개
/crt_event   → 사령술 도서관 발견 이벤트
```

각 스킬 호출은 직전 스킬이 만든 ID를 자연스럽게 참조 (의존성 자동 해소).

## 모든 스킬의 공통 규칙

1. **ID 규칙**: 영문 소문자 + 숫자 + 언더스코어. snake_case. 정규식 `^[a-z][a-z0-9_]*$`.
2. **이름 한글 OK**: name 필드는 자유로운 한국어/영어.
3. **변경 시 diff 출력**: 무엇이 바뀌었는지 사용자에게 보여줌.
4. **롤백 가능**: 빌드 실패하면 변경 전 상태로 자동 되돌림.
5. **승인 대기**: 큰 변경(예: 풀에 카드 10개 일괄 추가)은 사용자 명시 승인 필요.
6. **doc 동기화**: 새 필드나 새 effect kind가 추가되면 `docs/architecture/` 의 관련 문서에 노트 추가 안내.

## 스킬 자체의 구현 위치

```
plugins/textcrawlergame_authoring/
└── skills/
    ├── crt_card.md
    ├── crt_event.md
    ├── crt_modifier.md
    └── ...
```

각 스킬은 Claude 스킬 형식 (마크다운 + frontmatter). 이 게임 저장소와 같이 두면 사용자는 `~/.claude/plugins/` 에 심볼릭 링크/복사 한 번으로 사용 가능.

(스킬 자체 구현은 Phase 4 에서.)

## 미정 (TBD)

- 스킬 출력 형식 통일 (xlsx vs csv): v1은 xlsx 우선. 디자이너가 직접 편집할 때 편함.
- 자동 ID 생성 충돌 처리: `dagger_throw` 가 이미 있으면 `dagger_throw_2`? 또는 사용자 확인 강제?
- "역방향 스킬": 카드 인스턴스를 보고 어떤 모디파이어가 자주 붙는지 분석하는 메타 스킬 — v1 외.
- 자연어 모호성 해소: 사용자가 "강하게 공격" 같이 정량 없이 말하면 어떻게? 기본값 + 디자이너 확인.
