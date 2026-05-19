# 06. 메타 진행 시스템

캐릭터 수명을 넘어 영구히 유지되는 모든 시스템. 이 게임의 정체성(파밍 크롤러)의 본체.

## 분리: 글로벌 vs 슬롯

```
GlobalState        ── 모든 슬롯 공유. 캐릭터가 다 죽어도 절대 안 사라짐.
├ gold             ── 메타 골드 (시작 페이즈 스킬 구매, 인벤 업그레이드 등)
├ inventory        ── 차원 창고 (CardInstance 보관, 강화 그대로)
├ passiveSkills    ── 최종보스 보상으로 영구화된 스킬들
├ eventsCleared    ── oneShot 이벤트 클리어 이력
└ statistics       ── 누적 통계

Slot[i]            ── 캐릭터 한 명. 사망 시 삭제.
├ characterName
├ difficultyLevel  ── 캐릭터의 현재 난이도 카운터
├ state            ── empty | atRest | inRun | inStartPhase
└ ...
```

## 골드 시스템

### 두 종류의 골드

| 종류 | 위치 | 사용처 |
|---|---|---|
| **런 골드** | `RunState.player.gold` | 던전 내 상점, 이벤트 비용 |
| **메타 골드** | `GlobalState.gold` | 시작 페이즈 스킬 박스, 인벤 용량, 일부 이벤트 |

### 골드 흐름

```
[던전 중]
   적 처치, 보상, 카드 폐기 → 런 골드 += N

[휴식처 복귀 시]
   런 골드 100% → 메타 골드로 환원
   (사용자가 결정 X, 자동)

[휴식처에서 카드 판매]
   런 골드 또는 메타 골드? → 메타 골드로 (휴식처는 메타 공간)

[캐릭터 사망 시]
   런 골드 = 전손실 (메타로 환원 X)
   메타 골드 = 보존
```

### 골드 환산 규칙

카드를 판매하거나 (휴식처) 미보관 카드 자동 폐기 시 골드 환산:

```typescript
function cardSellPrice(card: CardInstance, def: CardDefinition): number {
  const rarityBase = { starter: 5, common: 10, uncommon: 25, rare: 60, special: 100 };
  const base = rarityBase[def.rarity];
  const modifierBonus = card.modifiers.length * 8;       // 강화 1개당 +8
  return base + modifierBonus;
}
```

(밸런싱은 디자이너가 데이터 테이블로 조정 가능: `authoring/economy/sell_prices.yaml`)

## 차원 창고 (Shared Inventory)

```typescript
interface InventoryState {
  capacity: number;                       // 최대 보관 카드 수
  cards: CardInstance[];                  // 강화 그대로 보존
}
```

### 용량 업그레이드

휴식처 메뉴에서 메타 골드 소비:

```yaml
# authoring/economy/inventory_upgrades.yaml
upgrades:
  - fromCapacity: 20    # 시작 용량
    toCapacity: 25
    costGold: 100
  - fromCapacity: 25
    toCapacity: 30
    costGold: 250
  - fromCapacity: 30
    toCapacity: 40
    costGold: 500
  - fromCapacity: 40
    toCapacity: 55
    costGold: 1200
  # ... 데이터로 무한 확장 가능
```

조회:
```typescript
function nextUpgrade(currentCap: number): UpgradeEntry | null {
  return upgrades.find(u => u.fromCapacity === currentCap) ?? null;
}
```

### 보관/회수 동작

```typescript
// 휴식처: 현재 슬롯의 마지막 런 덱에서 카드를 보관
function storeCardToInventory(slot: Slot, cardInstanceId: CardInstanceId): void {
  const deck = slot.lastRunDeck; // 휴식처에서 보유한 미정리 카드들
  const idx = deck.findIndex(c => c.instanceId === cardInstanceId);
  if (idx < 0) throw 'card not in deck';
  if (global.inventory.cards.length >= global.inventory.capacity) {
    throw 'inventory full';
  }
  const card = deck.splice(idx, 1)[0];
  global.inventory.cards.push(card);
}

// 신규 런 시작 시: 인벤에서 카드를 꺼냄 (시작 페이즈 또는 여정의 시작 이벤트)
function takeFromInventory(cardInstanceId: CardInstanceId, runDeck: CardInstance[]): void {
  const idx = global.inventory.cards.findIndex(c => c.instanceId === cardInstanceId);
  if (idx < 0) throw 'card not in inventory';
  const card = global.inventory.cards.splice(idx, 1)[0];
  runDeck.push(card);
}
```

### 인벤 가득 참 처리

- 보관 시도하는데 가득 차면: 휴식처 UI에서 "용량 부족" + 업그레이드 안내
- 무거운 강제 폐기 강요 없음 — 그냥 보관 못함
- 자동 폐기되는 미보관 카드는 인벤과 무관

## 미보관 카드 자동 폐기

휴식처 메뉴에서 "탐사 시작" 을 누르는 순간:

```typescript
function onBeginExploration(slot: Slot): void {
  const undeposited = slot.lastRunDeck;  // 사용자가 보관·판매 안 한 잔여 카드
  let goldGained = 0;
  for (const card of undeposited) {
    goldGained += cardSellPrice(card, getDef(card.defId));
  }
  global.gold += goldGained;
  slot.lastRunDeck = [];

  // 시작 페이즈로 진입
  slot.state = { kind: 'inStartPhase' };
  enterStartPhase(slot);
}
```

UI: 탐사 시작 누르면 "보관하지 않은 카드 N장이 골드 {X}로 변환됩니다. 진행할까요?" 확인 모달.

## 스킬 박스 (Skill Box)

### 등급과 가격 (데이터)

```yaml
# authoring/economy/skill_boxes.yaml
boxes:
  - grade: lowest
    price: 50
    poolId: pool_skills_lowest
    description: "최하급 스킬 1개를 얻는다."
  - grade: low
    price: 150
    poolId: pool_skills_low
  - grade: mid
    price: 400
    poolId: pool_skills_mid
  - grade: high
    price: 1000
    poolId: pool_skills_high
  - grade: highest
    price: 2500
    poolId: pool_skills_highest
```

스킬도 풀로 관리. 풀 안에서 가중치 샘플링.

### 시작 페이즈에서의 구매

```typescript
function enterStartPhase(slot: Slot): void {
  const affordable = boxes.filter(b => global.gold >= b.price);
  if (affordable.length === 0) {
    // 구매 못함 → 바로 던전 진입
    proceedToDungeon(slot);
    return;
  }
  // 구매 선택지 UI
  slot.state = { kind: 'inStartPhase', pendingSkillChoice: {
    affordableGrades: affordable.map(b => b.grade),
    cheapestPrice: Math.min(...affordable.map(b => b.price)),
  } };
}

function onBuySkillBox(grade: SkillGrade): void {
  const box = boxes.find(b => b.grade === grade)!;
  if (global.gold < box.price) throw 'insufficient gold';
  global.gold -= box.price;
  const skillId = sampleFromPool(box.poolId, rng);
  slot.character.skillIds.push(skillId);
  // 구매 후 추가 구매도 가능 (골드 남으면)
  // 또는 1회 제한? — 디자인: 시작 페이즈는 N번까지 (Default 1)
  proceedToDungeon(slot);
}
```

> **결정 필요**: 시작 페이즈에서 스킬 박스를 1번만 구매 가능? 또는 골드 남는 만큼 무한? 사용자 메시지에선 "한번 시도" 같은 늬앙스 — **시작 페이즈 1회로 시작**, 후속 디자인 변경 가능.

### 던전 중 스킬 획득

- 이벤트 보상 (`skillOffer` step)
- 일부 적/엘리트 드롭 (`EnemyRewards.skillDropChance`)
- 특수 상점 노드

캐릭터의 `skillIds` 에 누적. 동일 스킬 중복 보유 허용 여부는 스킬별로 다름 — `SkillDefinition.stackable: boolean` 필드 검토.

## 패시브 스킬 (Passive Skill)

### 정의

`PassiveSkill` 은 별도 타입이 아니다. `SkillId` 하나가 `global.passiveSkills` 에 들어 있으면:
- **모든 슬롯 캐릭터에게 자동 적용**
- 신규 캐릭터에도 처음부터 적용
- 캐릭터 사망과 무관

### 패시브 후보 조건

```typescript
interface SkillDefinition {
  // ...
  passiveEligible: boolean;     // 패시브화 가능 여부
}
```

`passiveEligible: false` 인 스킬은 패시브로 만들 수 없음 (디자인 균형용 — 너무 강한 스킬 영구화 방지).

### 최종보스 보상 흐름

```typescript
function onFinalBossDefeated(slot: Slot): void {
  // 1. 보유 스킬 중 passive 가능한 것들 후보
  const eligible = slot.skillIds.filter(id => {
    const def = registry.skill.get(id);
    return def.passiveEligible && !global.passiveSkills.includes(id);
  });
  if (eligible.length === 0) {
    // 모두 이미 패시브거나 자격 없음 → 보상 대체 (대량 골드 등)
    global.gold += 5000;
    notifyUser('영구화 가능한 새 스킬이 없어 보상으로 5000G를 받았습니다.');
    return;
  }
  // 2. UI: 후보 N개 중 1개 선택
  slot.state = { kind: 'passiveChoice', candidates: eligible };
}

function onPassiveChosen(slot: Slot, skillId: SkillId): void {
  global.passiveSkills.push(skillId);
  global.statistics.finalBossKills++;
  // 캐릭터 상태 정리: 최종보스 클리어 = 캐릭터 은퇴? 또는 다시 던전?
  // 디자인 결정: 클리어 후 캐릭터 은퇴 (슬롯 비움) + 신규 캐릭터로 다음 회차 시작
  clearSlot(slot.slotIndex);
}
```

### 패시브 적용

캐릭터 생성 또는 RunStart 시:
```typescript
function activatePassivesForSlot(slot: Slot): void {
  for (const passiveId of global.passiveSkills) {
    // 캐릭터가 이미 보유한 스킬이면 효과 중첩? — 디자인 결정: 중첩 X
    if (!slot.character.skillIds.includes(passiveId)) {
      // 가상으로 추가 — 일반 스킬 hook과 동일 경로로 발동
      slot.character.activePassives.push(passiveId);
    }
  }
}
```

훅 디스패치 시 캐릭터의 `skillIds` + `activePassives` 모두 순회.

## 난이도 시스템

### 캐릭터별 카운터

```typescript
slot.difficultyLevel: number   // 시작 0, 휴식처 복귀 시 +1
```

### 난이도 테이블 (데이터)

```yaml
# authoring/difficulty/difficulty_table.yaml
levels:
  - level: 0
    enemyHpMultiplier: 1.0
    enemyStrengthBonus: 0
    description: "첫 차원문"
  - level: 1
    enemyHpMultiplier: 1.1
    enemyStrengthBonus: 1
  - level: 2
    enemyHpMultiplier: 1.2
    enemyStrengthBonus: 2
  - level: 3
    enemyHpMultiplier: 1.3
    enemyStrengthBonus: 3
    specialBuffs:
      - { kind: thorns, amount: 2 }
    description: "가시 차원 — 모든 적이 가시 2를 가짐"
  - level: 5
    enemyHpMultiplier: 1.5
    enemyStrengthBonus: 5
    specialBuffs:
      - { kind: firstHitInvuln }
    description: "수호 차원 — 적의 첫 피격 무효화"
  # ... 최대 난이도 (예: level 20)
  - level: 20
    enemyHpMultiplier: 3.0
    enemyStrengthBonus: 15
    specialBuffs:
      - { kind: regenPerTurn, amount: 3 }
      - { kind: thorns, amount: 5 }
    description: "차원의 핵심 — 최종보스 차원문"
```

`level >= maxLevel` 인 캐릭터의 다음 휴식처 노드 = **최종보스 노드** 로 교체.

### 적용 시점

전투 시작 시 (`onCombatStart`):

```typescript
function applyDifficultyBuffs(combat: CombatState, level: number): void {
  const entry = difficultyTable.get(level);
  for (const enemy of combat.enemies) {
    enemy.maxHp = Math.round(enemy.maxHp * entry.enemyHpMultiplier);
    enemy.hp = enemy.maxHp;
    if (entry.enemyStrengthBonus > 0) {
      applyStatus(enemy, 'strength', entry.enemyStrengthBonus);
    }
    for (const buff of entry.specialBuffs ?? []) {
      applySpecialBuff(enemy, buff);
    }
  }
}
```

### 최대 난이도 도달 시

```typescript
function generateMapForRun(slot: Slot): MapState {
  const isFinalLevel = slot.difficultyLevel >= difficultyTable.maxLevel;
  const params: MapGenParams = {
    width: 5, height: 7,
    startKey: '2,6',
    restKey: '2,0',
    edgeKeepRatio: 0.7,
    nodeDistribution: defaultDist,
  };
  const map = generateMap(seed, params);

  if (isFinalLevel) {
    // restKey 노드를 최종보스 노드로 교체
    const restNode = map.nodes[params.restKey];
    restNode.nodeType = 'combat_boss';
    restNode.enemyGroupId = 'group_final_boss';
    restNode.eventId = undefined;
  }
  return map;
}
```

승리 시 → `onFinalBossDefeated` 흐름.
패배 시 → 일반 사망 처리.

## 사망 처리

```typescript
function onCharacterDeath(slotIndex: number): void {
  const slot = global.slots[slotIndex];
  // 1. 슬롯 데이터 삭제
  global.slots[slotIndex] = { slotIndex, state: { kind: 'empty' }, difficultyLevel: 0 };
  // 2. 통계 누적
  global.statistics.totalDeaths++;
  // 3. 글로벌(인벤/골드/패시브)은 그대로
  saveStore.persist();
  // 4. UI: 사망 화면 + 통계 → 타이틀로
}
```

런 골드는 위에서 명시했듯 **전손실** (휴식처 복귀해야 환원).

## 휴식처 메뉴 (Rest Hub)

휴식처는 페이즈가 아니라 **자유로운 메뉴**. 사용자가 "탐사 시작" 누를 때까지 무한 머무를 수 있음.

### 메뉴 항목

```
┌─ 휴식처 ────────────────────────────────┐
│ {playerName} (난이도 Lv {level})         │
│ 메타 골드: {gold}G                      │
│ 인벤토리: {used}/{capacity}             │
├─────────────────────────────────────────┤
│ > 이번 런에서 가져온 카드 보기 (N장)    │
│   인벤토리 관리 (보관/회수/판매)        │
│   인벤토리 용량 업그레이드              │
│   다음 차원문으로 탐사 시작 →            │
│   타이틀로 돌아가기 (저장)              │
└─────────────────────────────────────────┘
```

### "이번 런 카드 보기" 서브 메뉴
```
가져온 카드 (N장):
  > [보관] 단검투척 (+2 강화)
    [판매] 회복의 빛 (~25G)
    [강화 확인] 강타 (+1 강화)
  
→ Esc: 휴식처 메뉴로
```

각 카드마다 액션: `[보관]` `[판매]`. 보관 시 인벤 빈 자리 필요, 판매 시 즉시 메타 골드 증가.

### "인벤토리 관리"
```
인벤토리 (15/20):
  > 단검투척 (+3 강화)         [회수] [판매]
    방패 올리기 (+1 강화)      [회수] [판매]
    ...
```

회수 = 이번 휴식처를 떠나기 전 다음 런으로 가져갈 후보로 마크. (시작 페이즈에서 합류)

> **결정 필요**: "인벤 카드 회수" 가 휴식처 메뉴에서 일어나는지, 아니면 "여정의 시작" 이벤트의 차원 창고 선택지에서만인지. 일관성 위해 **휴식처에서만 회수 마크** → 시작 페이즈에서 마크된 카드들이 덱에 자동 합류. "여정의 시작" 의 차원 창고 선택지는 신규 캐릭터에게만 등장.

### "탐사 시작"

1. 미보관 카드 자동 폐기 → 메타 골드 환원 확인 모달
2. 시작 페이즈 진입 (스킬 박스 구매 등)
3. 던전 생성 + 입장
4. `slot.state = { kind: 'inRun', run }`

## 신규 캐릭터 생성

```typescript
function createNewCharacter(slotIndex: number, name: string): void {
  global.slots[slotIndex] = {
    slotIndex,
    characterName: name,
    difficultyLevel: 0,
    state: { kind: 'inStartPhase' },
    character: {
      maxHp: 70,         // 디자인 기본값
      hp: 70,
      skillIds: [],
      activePassives: [],
    },
    createdAt: Date.now(),
  };
  enterStartPhase(global.slots[slotIndex]);
}
```

신규 캐릭터의 `enterStartPhase` 는 휴식처에서 출발하는 캐릭터와 동일 흐름이지만 추가로:
- 차원 창고가 비어있지 않으면 "여정의 시작" 이벤트의 차원 창고 선택지 활성
- 메타 골드 충분하면 스킬 박스 구매 가능

## 통계 (Optional)

```typescript
interface GlobalStatistics {
  totalRuns: number;
  totalRunsCompleted: number;
  totalDeaths: number;
  totalCardsAcquired: number;
  totalCardsModified: number;
  totalGoldEarned: number;
  finalBossKills: number;
  highestDifficultyReached: number;
  playTimeMs: number;
}
```

저장만 하고 UI 표시는 후순위. 디버그/메타게임 가치.

## 미정 (TBD)

- **시작 페이즈 스킬 박스**: 1회 제한 vs 무제한 — 1회로 시작 권장.
- **시작 HP**: 캐릭터 직업이 없으니 고정 (70?) 또는 패시브로 늘림.
- **사망 시 손실 정책 강화**: 추가 페널티? (예: 메타 골드 10% 손실) — 일단 없음.
- **인벤 정렬/필터**: 카드 종류·강화수·이름 기준 정렬 UI — v1 범위.
- **패시브 후보가 없을 때의 보상 대체**: 골드 5000G로 시작.
- **회차 표시**: "이번이 N번째 도전" 같은 메타 표시 — UI 옵션.
