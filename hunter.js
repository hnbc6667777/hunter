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

    // 定义工具基础名称（不包含特定材质，如 pickaxe 匹配所有镐）
    const toolBaseNames = ['pickaxe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'flint_and_steel', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush']
    const shieldBaseNames = ['shield']

    // 收集需要取出的物品
    const toWithdraw = []

    for (const item of container.containerItems()) {
      // 食物：少于16个则补充到16个
      if (foodNames.includes(item.name)) {
        const currentCount = bot.inventory.count(item.type, null)
        if (currentCount < 16) {
          const need = 16 - currentCount
          const take = Math.min(need, item.count)
          if (take > 0) toWithdraw.push({ type: item.type, count: take, nbt: item.nbt })
        }
      }
      // 武器：如果背包中没有武器则取1件（已有武器则跳过）
      else if (weaponNames.includes(item.name)) {
        const hasWeapon = bot.inventory.items().some(i => weaponNames.includes(i.name))
        if (!hasWeapon) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      }
      // 装备：每种类型取1件（后续由armorManager自动穿上）
      else if (armorTypes.some(type => item.name.includes(type))) {
        toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
      }
      // 工具：如果背包中缺少该类型工具，则取1件
      else if (toolBaseNames.some(base => item.name.includes(base))) {
        const baseType = toolBaseNames.find(base => item.name.includes(base))
        const hasThisTool = bot.inventory.items().some(i => i.name.includes(baseType))
        if (!hasThisTool) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      }
      // 盾牌：如果背包中没有盾牌，则取1件
      else if (shieldBaseNames.some(base => item.name.includes(base))) {
        const hasShield = bot.inventory.items().some(i => shieldBaseNames.some(sn => i.name.includes(sn)))
        if (!hasShield) {
          toWithdraw.push({ type: item.type, count: 1, nbt: item.nbt })
        }
      }
    }

    // 执行取出
    for (const req of toWithdraw) {
      await container.withdraw(req.type, null, req.count, req.nbt)
      const itemName = bot.registry.items[req.type]?.name || 'unknown'
      console.log(`Took ${req.count} x ${itemName}`)
    }

    container.close()

    // 自动穿上最佳装备
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

// 自动攻击逻辑
bot.on('physicsTick', async () => {
  if (bot.pvp.target || bot.isBusy) return

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
})

async function selectWeaponForTarget(entity) {
  const sword = bot.inventory.items().find(item => item.name.includes('sword'))
  if (sword) {
    console.log(`🗡️ Found sword: ${sword.name}, equipping...`)
    await bot.equip(sword, 'hand')
    console.log(`🗡️ Equipped sword: ${sword.name}`)
    return
  }
  const axe = bot.inventory.items().find(item => item.name.includes('axe'))
  if (axe) {
    console.log(`🪓 Found axe: ${axe.name}, equipping...`)
    await bot.equip(axe, 'hand')
    console.log(`🪓 Equipped axe: ${axe.name}`)
    return
  }
  console.log('👊 No weapon found, using fists.')
}

// 统一的目标判断函数
function isTarget(entity) {
  if (!entity) return false
  if (entity.type === 'player') return false          // 排除玩家
  if (entity.name === 'armor_stand') return false     // 排除盔甲架
  // 包含所有可攻击的生物类型
  const targetTypes = ['hostile', 'passive', 'mob', 'animal', 'water_creature']
  return targetTypes.includes(entity.type)
}

bot.on('chat', async (username, message) => {  // 改为 async
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
  }   else if (message === 'attack') {
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
    bot.chat('Hunting mode activated!')
  } else if (message === 'stop') {
    bot.pvp.stop()
    bot.pathfinder.setGoal(null)
    bot.chat('Stopped hunting.')
  } else if (message === 'come') {
    const player = bot.players[username]
    if (player && player.entity) {
      const goal = new goals.GoalNear(
        player.entity.position.x,
        player.entity.position.y,
        player.entity.position.z,
        2
      )
      bot.pathfinder.setGoal(goal)
      bot.chat('Coming!')
    }
  }
})

bot.on('error', err => console.error('❌ Bot error:', err))
bot.on('end', reason => {
  console.log('🔌 Bot disconnected:', reason)
  if (depositInterval) clearInterval(depositInterval)
})
