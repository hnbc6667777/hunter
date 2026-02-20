const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const toolPlugin = require('mineflayer-tool').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const mcDataLoader = require('minecraft-data')

if (process.argv.length < 4 || process.argv.length > 6) {
  console.log('Usage: node hunter.js <host> <port> [<name>] [<password>]')
  process.exit(1)
}

const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  username: process.argv[4] || 'Hunter',
  password: process.argv[5]
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(toolPlugin)
bot.loadPlugin(autoEat)
bot.loadPlugin(armorManager)

bot.isBusy = false
let depositInterval = null
let guardPos = null // 值守位置

// ------------------ 辅助函数 ------------------
function findNearestChest(mcData) {
  const chestIds = [
    mcData.blocksByName.chest?.id,
    mcData.blocksByName.trapped_chest?.id,
    mcData.blocksByName.barrel?.id
  ].filter(id => id !== undefined)

  if (chestIds.length === 0) {
    console.log('No chest types found in this version.')
    return null
  }

  const blocks = bot.findBlocks({
    matching: block => chestIds.includes(block.type),
    maxDistance: 32,
    count: 1
  })

  if (blocks.length === 0) return null
  return bot.blockAt(blocks[0])
}

async function goToChest(chestBlock) {
  const goal = new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
  await bot.pathfinder.goto(goal)
}

// 目标判断：排除玩家、盔甲架、水中生物，并可选深度过滤
function isTarget(entity) {
  if (!entity) return false
  if (entity.type === 'player') return false
  if (entity.name === 'armor_stand') return false
  if (entity.isInWater) return false
  // 可根据世界调整地表高度，此处设为 >60（地面层）
  if (entity.position.y < 60) return false

  const targetTypes = ['hostile', 'passive', 'mob', 'animal']
  return targetTypes.includes(entity.type)
}

// 武器选择（优先剑，其次斧，最后镐）
async function selectWeaponForTarget(entity) {
  const sword = bot.inventory.items().find(item => item.name.endsWith('_sword'))
  if (sword) {
    console.log(`🗡️ Found sword: ${sword.name}, equipping...`)
    await bot.equip(sword, 'hand')
    console.log(`🗡️ Equipped sword: ${sword.name}`)
    return
  }
  const axe = bot.inventory.items().find(item => item.name.endsWith('_axe'))
  if (axe) {
    console.log(`🪓 Found axe: ${axe.name}, equipping...`)
    await bot.equip(axe, 'hand')
    console.log(`🪓 Equipped axe: ${axe.name}`)
    return
  }
  const pickaxe = bot.inventory.items().find(item => item.name.endsWith('_pickaxe'))
  if (pickaxe) {
    console.log(`⛏️ No sword/axe, using pickaxe: ${pickaxe.name}`)
    await bot.equip(pickaxe, 'hand')
    return
  }
  console.log('👊 No weapon found, using fists.')
}

// ------------------ 补给功能 ------------------
async function takeSupplies() {
  if (bot.isBusy || bot.pvp.target) {
    bot.chat('I am busy right now.')
    return
  }
  bot.isBusy = true
  bot.pvp.stop()
  bot.pathfinder.setGoal(null)

  try {
    const mcData = mcDataLoader(bot.version)
    const chest = findNearestChest(mcData)
    if (!chest) {
      bot.chat('No chest found nearby.')
      return
    }

    bot.chat('Moving to chest to take supplies...')
    await goToChest(chest)

    const container = await bot.openContainer(chest)
    bot.chat('Chest opened. Taking supplies...')

    const foodItems = bot.autoEat.foodsArray || []
    const foodNames = foodItems.map(f => f.name)

    const weaponNames = Object.values(mcData.items)
      .filter(item => item.name.includes('sword') || item.name.includes('axe') || item.name.includes('bow') || item.name.includes('crossbow'))
      .map(item => item.name)

    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots']
    const toolBaseNames = ['pickaxe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'flint_and_steel', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush']
    const shieldBaseNames = ['shield']

    const toWithdraw = []

    for (const item of container.containerItems()) {
      if (foodNames.includes(item.name)) {
        const currentCount = bot.inventory.count(item.type, null)
        if (currentCount < 16) {
          const need = 16 - currentCount
          const take = Math.min(need, item.count)
          if (take > 0) toWithdraw.push({ type: item.type, count: take, nbt: item.nbt })
        }
      } else if (weaponNames.includes(item.name)) {
        const hasWeapon = bot.inventory.items().some(i => weaponNames.includes(i.name))
        if (!hasWeapon) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      } else if (armorTypes.some(type => item.name.includes(type))) {
        toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
      } else if (toolBaseNames.some(base => item.name.includes(base))) {
        const baseType = toolBaseNames.find(base => item.name.includes(base))
        const hasThisTool = bot.inventory.items().some(i => i.name.includes(baseType))
        if (!hasThisTool) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      } else if (shieldBaseNames.some(base => item.name.includes(base))) {
        const hasShield = bot.inventory.items().some(i => shieldBaseNames.some(sn => i.name.includes(sn)))
        if (!hasShield) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      }
    }

    for (const req of toWithdraw) {
      await container.withdraw(req.type, null, req.count, req.nbt)
      const itemName = bot.registry.items[req.type]?.name || 'unknown'
      console.log(`Took ${req.count} x ${itemName}`)
    }

    container.close()
    bot.armorManager.equipAll()
    bot.chat('Supplies taken and best armor equipped.')
  } catch (err) {
    console.error('Error during restock:', err)
    bot.chat('Failed to restock.')
  } finally {
    bot.isBusy = false
  }
}

async function depositLoot() {
  if (bot.isBusy || bot.pvp.target) {
    console.log('Cannot deposit: bot is busy or fighting.')
    return
  }
  bot.isBusy = true
  bot.pvp.stop()
  bot.pathfinder.setGoal(null)

  try {
    const mcData = mcDataLoader(bot.version)
    const chest = findNearestChest(mcData)
    if (!chest) {
      bot.chat('No chest found nearby.')
      return
    }

    bot.chat('Moving to chest to deposit loot...')
    await goToChest(chest)

    const container = await bot.openContainer(chest)
    bot.chat('Chest opened. Depositing loot...')

    const inventoryStart = container.inventorySlotStart
    const inventoryEnd = container.inventorySlotEnd
    const hotbarStart = inventoryStart
    const hotbarEnd = inventoryStart + 8
    const armorStart = inventoryStart + 5
    const armorEnd = inventoryStart + 8

    for (let slot = inventoryStart; slot <= inventoryEnd; slot++) {
      if (slot >= hotbarStart && slot <= hotbarEnd) continue
      if (slot >= armorStart && slot <= armorEnd) continue

      const item = bot.inventory.slots[slot]
      if (item) {
        await container.deposit(item.type, null, item.count, item.nbt)
        console.log(`Deposited ${item.count} x ${item.name}`)
      }
    }

    container.close()
    bot.chat('Loot deposited.')
  } catch (err) {
    console.error('Error during deposit:', err)
    bot.chat('Failed to deposit loot.')
  } finally {
    bot.isBusy = false
  }
}

function startAutoDeposit() {
  if (depositInterval) clearInterval(depositInterval)
  depositInterval = setInterval(() => {
    if (bot.pvp.target) {
      console.log('⏭️ Auto deposit skipped: bot is fighting.')
      return
    }
    depositLoot()
  }, 500 * 1000)
}

// ------------------ 值守相关函数 ------------------
function startGuarding(pos) {
  guardPos = pos.clone()
  bot.chat(`I will guard this area (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}).`)
  // 立即移动到值守点
  moveToGuardPos()
}

function stopGuarding() {
  if (guardPos) {
    guardPos = null
    bot.chat('Stopped guarding.')
  }
}

async function moveToGuardPos() {
  if (!guardPos) return
  const goal = new goals.GoalNear(guardPos.x, guardPos.y, guardPos.z, 2)
  await bot.pathfinder.goto(goal)
  console.log('✅ Returned to guard position.')
}

// ------------------ 事件监听 ------------------
bot.once('spawn', () => {
  console.log('✅ Bot spawned!')

  const mcData = mcDataLoader(bot.version)
  console.log(`📦 Minecraft version: ${bot.version}`)

  const movements = new Movements(bot, mcData)
  movements.allowParkour = true
  movements.canDig = false
  bot.pathfinder.setMovements(movements)
  console.log('🔧 Pathfinder movements configured.')

  bot.armorManager.equipAll()
  console.log('🛡️ Armor equipped.')

  bot.autoEat.enableAuto()
  bot.autoEat.setOpts({
    priority: 'foodPoints',
    minHunger: 14,
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye']
  })
  console.log('🍖 Auto-eat enabled.')

  startAutoDeposit()
  console.log('⏰ Auto deposit every 500s started.')

  setTimeout(() => {
    const entities = Object.values(bot.entities)
    console.log(`🌍 Nearby entities (${entities.length}):`)
    entities.forEach(e => {
      console.log(`  - ${e.name || e.type} (${e.type}) at ${e.position.floored()}`)
    })
  }, 2000)
})

// 自动攻击/值守逻辑
bot.on('physicsTick', async () => {
  if (bot.pvp.target || bot.isBusy) return

  // 值守模式
  if (guardPos) {
    // 只在距值守点 16 格内寻找目标
    const target = bot.nearestEntity(e =>
      isTarget(e) &&
      e.position.distanceTo(guardPos) < 16 &&
      e.position.distanceTo(bot.entity.position) < 32 // 同时考虑视野范围
    )

    if (target) {
      console.log(`🎯 Guard target: ${target.name || target.type} at distance ${target.position.distanceTo(bot.entity.position).toFixed(1)}`)
      await selectWeaponForTarget(target)
      bot.pvp.attack(target)
      return
    }

    // 没有目标且离值守点较远时，返回值守点
    const distToGuard = bot.entity.position.distanceTo(guardPos)
    if (distToGuard > 4) {
      console.log(`⏪ Returning to guard point (${distToGuard.toFixed(1)} blocks away)`)
      moveToGuardPos().catch(err => console.error('Move to guard failed:', err))
    }
    return
  }

  // 自由狩猎模式（原有逻辑）
  const target = bot.nearestEntity(e =>
    isTarget(e) && e.position.distanceTo(bot.entity.position) < 32
  )
  if (target) {
    console.log(`🎯 Auto target: ${target.name || target.type} at distance ${target.position.distanceTo(bot.entity.position).toFixed(1)}`)
    await selectWeaponForTarget(target)
    bot.pvp.attack(target)
  }
})

bot.on('stoppedAttacking', () => {
  console.log('🛑 Stopped attacking')
  // 如果是值守模式且不在值守点附近，则返回
  if (guardPos && bot.entity.position.distanceTo(guardPos) > 4) {
    moveToGuardPos().catch(err => console.error('Return to guard failed:', err))
  }
})

// ------------------ 聊天命令 ------------------
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  console.log(`💬 Chat from ${username}: ${message}`)

  if (message === 'restock') {
    bot.chat('Restocking supplies...')
    takeSupplies()
  } else if (message === 'deposit') {
    bot.chat('Depositing loot...')
    depositLoot()
  } else if (message === 'scan') {
    const entities = Object.values(bot.entities)
    console.log(`Nearby entities (${entities.length}):`)
    entities.forEach(e => {
      const dist = e.position.distanceTo(bot.entity.position)
      console.log(`  - ${e.name || e.type} (${e.type}) at ${e.position.floored()}, dist=${dist.toFixed(1)}`)
    })
  } else if (message === 'guard') {
    const player = bot.players[username]
    if (!player || !player.entity) {
      bot.chat("I can't see you.")
      return
    }
    startGuarding(player.entity.position)
  } else if (message === 'stop') {
    // 停止所有活动：攻击、寻路、值守
    bot.pvp.stop()
    bot.pathfinder.setGoal(null)
    stopGuarding()
    bot.chat('Stopped all activities.')
  } else if (message === 'attack') {
    const target = bot.nearestEntity(e => isTarget(e))
    if (target) {
      const dist = target.position.distanceTo(bot.entity.position).toFixed(1)
      console.log(`⚔️ Manual attack targeting: ${target.name || target.type} at distance ${dist}`)
      try {
        await selectWeaponForTarget(target)
        bot.pvp.attack(target)
        bot.chat(`Attacking ${target.name || target.type}`)
      } catch (err) {
        console.error('Attack preparation failed:', err)
        bot.chat('Cannot attack.')
      }
    } else {
      bot.chat('No target nearby.')
    }
  } else if (message === 'hunt') {
    // 切换到自由狩猎模式（清除值守点）
    stopGuarding()
    bot.chat('Hunting mode activated.')
  }
})

bot.on('error', err => console.error('❌ Bot error:', err))
bot.on('end', reason => {
  console.log('🔌 Bot disconnected:', reason)
  if (depositInterval) clearInterval(depositInterval)
})