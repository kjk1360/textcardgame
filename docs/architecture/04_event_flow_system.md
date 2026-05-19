# 04. 이벤트 & 플로우 시스템

## 핵심 개념

- **EventDefinition** — 맵 노드에 배치되는 "이벤트". 어떤 Flow를 실행할지 가리키는 얇은 메타데이터.
- **FlowDefinition** — 시나리오. 대사/선택지/카드제안 등 step의 그래프.
- **FlowStep** — Flow를 구성하는 노드 단위. 11종.
- **FlowRuntime** — Flow를 실행하는 인터프리터. 현재 step, 변수, 분기 관리.
- **ConditionEvaluator** — 조건식 평가기.

## 두 층의 분리

```
EventDefinition (얇음)
├── id, name, nodeType, oneShot, availability
└── flowId → FlowDefinition (재사용 가능)

FlowDefinition (두꺼움)
├── entryStepId
└── steps: Record<string, FlowStep>
```

같은 Flow를 여러 Event가 참조할 수 있다. 시나리오 12번 같은 게 재사용 템플릿.

## FlowRuntime — 실행 엔진

```typescript
class FlowRuntime {
  state: EventRuntimeState;

  start(eventId: EventId): void {
    const event = registry.event.get(eventId);
    const flow = registry.flow.get(event.flowId);
    this.state = {
      eventId,
      flowId: event.flowId,
      currentStepId: flow.entryStepId,
      history: [],
      variables: {},
    };
    this.executeCurrentStep();
  }

  advance(action: FlowAction): void {
    // 사용자 액션을 받아 현재 step에 전달, 다음 step으로 이동
    const step = this.currentStep();
    switch (step.kind) {
      case 'dialogue':
        this.goto(step.next);
        break;
      case 'choice':
        const opt = step.options[(action as any).optionIndex];
        this.applyChoice(opt);
        break;
      case 'cardOffer':
        // 한 iteration 완료마다 advance
        this.handleCardPick(action);
        break;
      // ...
    }
  }

  private goto(stepId: string): void {
    this.state.history.push(this.state.currentStepId);
    this.state.currentStepId = stepId;
    this.executeCurrentStep();
  }

  private executeCurrentStep(): void {
    const step = this.currentStep();
    switch (step.kind) {
      case 'applyEffect':
        for (const eff of step.effects) effectExecutor.run(eff, this.makeCtx());
        this.goto(step.next);
        break;
      case 'branch':
        for (const br of step.branches) {
          if (conditionEvaluator.eval(br.condition, this.makeCtx())) {
            this.goto(br.next);
            return;
          }
        }
        this.goto(step.defaultNext);
        break;
      case 'goto':
        this.goto(step.stepId);
        break;
      case 'end':
        this.finish(step.outcome ?? 'neutral');
        break;
      // dialogue/choice/cardOffer 등은 사용자 입력 대기
      default:
        // UI 측에서 현재 step을 읽어 렌더링
        break;
    }
  }

  private finish(outcome: 'success' | 'failure' | 'neutral'): void {
    // 1. 이벤트 클리어 마킹
    if (registry.event.get(this.state.eventId).oneShot) {
      global.eventsCleared.add(this.state.eventId);
    }
    // 2. 노드 visited 처리
    map.markVisited(currentNodeKey);
    // 3. RunState로 컨트롤 반환
    run.currentEvent = undefined;
    onEventFinished(outcome);
  }
}
```

## FlowStep 상세

### 1. `dialogue` — 대사

```yaml
- id: intro_1
  kind: dialogue
  speaker: "차원의 안내자"
  text: "{playerName}여, 새로운 차원에 온 것을 환영한다."
  next: intro_2
```

변수 치환: `{playerName}`, `{gold}`, `{difficulty}`, `{maxHp}`, `{currentHp}`, 그리고 `EventRuntimeState.variables.*`.

UI: 텍스트 표시 + "다음" 키 입력 대기 (Enter).

### 2. `choice` — 선택지

```yaml
- id: shop_main
  kind: choice
  prompt: "무엇을 하시겠습니까?"
  options:
    - label: "카드 보기 (50G)"
      condition: { kind: hasGold, min: 50 }
      effects:
        - { kind: loseGold, amount: 50 }  # 이벤트용 효과 (런 골드 소모)
      next: shop_cards
    - label: "강화 받기 (75G)"
      condition: { kind: hasGold, min: 75 }
      effects:
        - { kind: loseGold, amount: 75 }
      next: shop_upgrade
    - label: "(영혼의 인장 보유) 비밀 거래 보기"
      hidden: { kind: not, of: { kind: hasSkill, skillId: skill_soul_seal } }
      next: shop_secret
    - label: "떠난다"
      next: end_node
```

UI: 좌측에 옵션 리스트, 우측에 강조된 옵션의 결과/조건 설명. 비활성 옵션은 회색 + 사유 표시 ("골드 부족 — 50 필요, 현재 30").

### 3. `cardOffer` — 카드 제안

```yaml
- id: start_card_picks
  kind: cardOffer
  poolId: pool_start_cards
  picksPerIteration: 3
  iterations: 5
  destination: currentDeck
  next: end_intro
```

런타임 동작:
```
iteration 1: pool에서 3개 샘플 → 유저 1개 선택 → currentDeck에 추가
iteration 2: 다시 3개 샘플 (이전 선택 카드도 다시 후보 가능) → 1개 선택
...
iteration 5: 동일
→ next로 진행
```

`allowSkip: true` 인 iteration은 "건너뛰기" 옵션 추가.

`destination`:
- `currentDeck`: 현재 런의 덱에 추가
- `inventory`: 글로벌 인벤토리로 직행 (보관)

### 4. `skillOffer` — 스킬 제안

```yaml
- id: skill_pick
  kind: skillOffer
  grade: low
  count: 3
  allowSkip: true
  next: continue
```

`grade` 또는 `poolOverride` 중 하나 사용. `count` 만큼 후보 제시, 유저가 1개 선택.

### 5. `cardUpgrade` — 카드 강화

```yaml
- id: upgrade_step
  kind: cardUpgrade
  source: currentDeck
  cardFilter:
    tags: [physical]               # 물리 카드만 선택 가능
  modifierPoolOverride:
    add: [pool_blessed]             # 이벤트 전용 풀 추가
    remove: [pool_cursed]
  count: 1
  allowSkip: false
  next: end_node
```

런타임:
```
1. cardFilter로 currentDeck에서 후보 인스턴스 추림
2. 유저가 1장 선택
3. resolveUpgradePools(card.def, override) → 후보 pools
4. ModifierResolver 가 후보 모디파이어 N개 (관행상 3) 샘플
5. 유저가 1개 선택 → 카드에 부착
6. count 만큼 반복
7. next
```

### 6. `cardModifierAttach` — 강제 모디파이어 부착

```yaml
- id: curse_attach
  kind: cardModifierAttach
  cardInstanceSelector: choose       # 유저가 1장 선택
  modifierId: mod_curse_drain
  next: end_node
```

또는 `cardInstanceSelector: allInDeck` 으로 전체 적용 (이벤트 페널티).

### 7. `applyEffect` — 직접 효과

```yaml
- id: lose_hp_3
  kind: applyEffect
  effects:
    - { kind: loseHp, amount: 3 }
    - { kind: gainGold, amount: 30 }
  next: end_node
```

이벤트 컨텍스트에서 쓸 수 있는 효과는 전투용 효과의 super set. 추가:
- `gainCardToInventory` — 차원 창고로
- `gainSkill` — 스킬 추가
- `gainGoldMeta` — 글로벌 골드
- `loseGold` — 런 골드 소모 (상점)
- `unlockEvent` — 향후 이벤트 활성화
- `lockEvent` — 향후 이벤트 비활성화

### 8. `branch` — 조건 분기

```yaml
- id: hp_check
  kind: branch
  branches:
    - condition: { kind: hpPercent, max: 25 }
      next: low_hp_branch
    - condition: { kind: hasSkill, skillId: skill_haggle }
      next: discount_branch
  defaultNext: normal_branch
```

평가 순서: 첫 매치된 branch로 점프. 모두 미충족 시 `defaultNext`.

### 9. `combatStart` — 전투 진입

```yaml
- id: ambush_combat
  kind: combatStart
  enemyGroupId: group_3_thieves
  afterVictoryNext: loot
  afterDefeatNext: defeat_dialogue   # 미지정 시 사망 처리
  rewardOverrides:
    goldRange: [50, 80]              # 이벤트 보너스
```

전투는 별도 시스템(03)으로 위임. 종료 결과에 따라 next 결정.

### 10. `goto` — 점프

```yaml
- id: skip
  kind: goto
  stepId: end_node
```

`branch` 의 단순 형태. 라벨 관리에 유용.

### 11. `end` — 종료

```yaml
- id: end_node
  kind: end
  outcome: success
```

`outcome` 은 후속 처리(예: 통계, 다음 이벤트 잠금 해제)에 사용.

## 조건식 (ConditionExpr)

01 문서 참조. 평가기 구조:

```typescript
class ConditionEvaluator {
  eval(c: ConditionExpr, ctx: ConditionContext): boolean {
    switch (c.kind) {
      case 'always':         return true;
      case 'never':          return false;
      case 'and':            return c.of.every(x => this.eval(x, ctx));
      case 'or':             return c.of.some (x => this.eval(x, ctx));
      case 'not':            return !this.eval(c.of, ctx);
      case 'hasGold':        return inRange(ctx.run.player.gold, c.min, c.max);
      case 'hasGoldMeta':    return ctx.global.gold >= (c.min ?? 0);
      case 'hasCardInDeck':  return countCards(ctx.run.player, c) >= (c.min ?? 1);
      case 'hasCardInInventory': return countInvCards(ctx.global, c) >= (c.min ?? 1);
      case 'hasSkill':       return ctx.run.player.skillIds.includes(c.skillId);
      case 'hasPassive':     return ctx.global.passiveSkills.includes(c.skillId);
      case 'hpPercent':      return inRange((ctx.run.player.hp / ctx.run.player.maxHp) * 100, c.min, c.max);
      case 'difficultyAtLeast': return ctx.run.difficultyLevel >= c.level;
      case 'eventCleared':   return ctx.global.eventsCleared.has(c.eventId);
      case 'eventNotCleared':return !ctx.global.eventsCleared.has(c.eventId);
      case 'random':         return ctx.rng.float() < c.chance;
      case 'custom':         return ctx.customPredicates.get(c.predicateId)(c.params, ctx);
    }
  }
}
```

`random` 평가는 **평가 시점에 1회 굴림** — 같은 step에서 여러 번 평가하면 결과가 일관되어야 하므로 첫 평가 결과를 캐싱하거나, 사용 직전 단 1회만 평가하는 패턴이 필요.

## 확률 분기 (`probabilistic`)

`ChoiceOption.probabilistic` 은 선택 후 즉시 주사위:

```typescript
function applyChoice(opt: ChoiceOption): void {
  for (const eff of opt.effects ?? []) effectExecutor.run(eff, ctx);
  if (opt.probabilistic) {
    const chance = resolveProbabilisticChance(opt.probabilistic, ctx);
    if (ctx.rng.float() < chance) {
      goto(opt.probabilistic.successNext);
    } else {
      goto(opt.probabilistic.failureNext);
    }
  } else if (opt.next) {
    goto(opt.next);
  }
}

function resolveProbabilisticChance(p: ProbabilisticBranch, ctx): number {
  // 기본 chance에 보정 (스킬/유물에 의한 보너스)
  let chance = p.chance;
  if (p.chanceModifierExpr) {
    chance = customExprResolver(p.chanceModifierExpr, ctx, chance);
  }
  return Math.max(0, Math.min(1, chance));
}
```

이벤트 작성 시 사용:
```yaml
- label: "함정을 해체해본다"
  probabilistic:
    chance: 0.6
    chanceModifierExpr: "+0.15 if hasSkill('skill_dexterous')"
    successNext: trap_disarmed
    failureNext: trap_triggered
```

## 변수 시스템 (제한적)

`EventRuntimeState.variables` 는 step 간 임시 메모리:
- `cardOffer` 의 결과 카드 ID 저장
- 분기 변수 (예: 동행자 이름)

v1 에서 변수 set은 `applyEffect` 의 특수 effect로:
```yaml
- kind: setVariable
  key: 'chosen_door'
  value: 'left'
```

`branch` 에서 변수 참조:
```yaml
condition: { kind: variableEq, key: 'chosen_door', value: 'left' }
```

(이건 `ConditionExpr` 에 `variableEq` kind 추가 필요. 일단 TBD로 두고 첫 이벤트들에서 정말 필요한지 검증 후 추가.)

## 이벤트 일회성 (`oneShot`)

`EventDefinition.oneShot: true` 인 이벤트:
- `global.eventsCleared` 에 ID 등록
- 다음 맵 생성 시 후보 풀에서 제외
- `eventCleared` 조건으로 다른 이벤트가 참조 가능 (체인 시나리오)

## 카드 풀 (CardPool)

`cardOffer` 가 참조하는 풀:
```typescript
interface CardPool {
  readonly id: string;
  readonly name: string;
  readonly entries: ReadonlyArray<{
    cardDefId: CardDefId;
    weight: number;
    conditional?: PoolCondition;
  }>;
}
```

`ModifierPool` 과 구조 동일하지만 다른 레지스트리로 분리 (개념상 명확).

예시 `pool_start_cards`:
```yaml
id: pool_start_cards
name: "여정의 시작 — 입문 카드"
entries:
  - { cardDefId: strike,        weight: 20 }
  - { cardDefId: defend,        weight: 20 }
  - { cardDefId: dagger_throw,  weight: 10 }
  - { cardDefId: heal_light,    weight: 5  }
  - { cardDefId: cleanse,       weight: 3  }
```

## "여정의 시작" 완전 예시

사용자가 처음 제시한 시나리오를 완전한 데이터로 구체화:

```yaml
# authoring/events/journey_start.yaml
event:
  id: journey_start
  name: "여정의 시작"
  nodeType: event_trigger
  flowId: scenario_journey_start
  oneShot: false                   # 모든 신규 캐릭터에게 매번 등장

flow:
  id: scenario_journey_start
  entryStepId: opening
  steps:
    opening:
      kind: dialogue
      speaker: "차원의 안내자"
      text: "또 한 명의 도전자가 왔군. 너의 첫 무기를 골라야 한다."
      next: pick_loop_intro

    pick_loop_intro:
      kind: dialogue
      text: "다섯 번에 걸쳐, 세 장 중 한 장을 골라라."
      next: card_picks

    card_picks:
      kind: cardOffer
      poolId: pool_start_cards
      picksPerIteration: 3
      iterations: 5
      destination: currentDeck
      next: warehouse_branch

    warehouse_branch:
      kind: branch
      branches:
        - condition: { kind: not, of: { kind: hasCardInInventory } }
          next: depart
      defaultNext: warehouse_offer

    warehouse_offer:
      kind: choice
      prompt: "차원 창고에서 물건을 살펴보겠는가?"
      options:
        - label: "꺼낸다"
          next: warehouse_pick
        - label: "이번 생은 가진 것만으로 간다"
          next: depart

    warehouse_pick:
      # 인벤토리에서 N장 꺼내는 special step
      # (별도 step 종류 또는 cardOffer + destination=fromInventory 디자인)
      kind: cardOffer
      poolId: __inventory_dynamic__   # 특수 — 런타임에 인벤 카드로 풀 구성
      picksPerIteration: 0             # 0 = 모두 보여줌
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

> "차원 창고에서 꺼내기" 는 `cardOffer` 의 특수 풀 ID (`__inventory_dynamic__`) 로 처리. 런타임에 인벤토리 인스턴스 ID 리스트를 그 자리에서 풀로 변환. 또는 별도 step `inventoryTake` 신설 — 선택 사항.

## 이벤트 작성 워크플로우 (Skill 측)

`/crt_event` 스킬이 다음을 자동화:
1. 사용자의 자연어 설명 받기
2. 이벤트 구조화 (대사·선택지·분기 추출)
3. 필요한 풀/스킬/카드/모디파이어가 이미 있는지 확인
4. 없는 것은 별도 스킬로 만들도록 안내 (`/crt_pool`, `/crt_card` …)
5. YAML 파일 생성 → `authoring/events/<id>.yaml`
6. 빌드 실행 → 검증 통과 확인

자세한 스킬 명세는 `09_skill_authoring.md` 참조.

## 미정 (TBD)

- `__inventory_dynamic__` 같은 특수 풀 vs 별도 step 타입: 1차 구현 시 후자가 더 깔끔할 수도. 초안에선 특수 풀, 구현 중 평가.
- 변수 시스템의 범위: 진짜 필요한지 첫 이벤트 10개 만들어보고 결정.
- 이벤트 결과 로그: "이벤트에서 카드를 얻었다 ✓", "함정에 걸렸다 ✗" 같은 런 로그가 필요할지.
- 다중 노드 이벤트 (예: 한 이벤트가 끝나면 다른 노드에 영향): v1 범위 외.
