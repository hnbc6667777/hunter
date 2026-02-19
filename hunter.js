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

// 加载插件
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(toolPlugin)
bot.loadPlugin(autoEat)
bot.loadPlugin(armorManager)

// 全局状态
bot.isBusy = false // 是否正在执行存取操作
let depositInterval = null

// 辅助函数：查找最近的箱子（支持 chest, trapped_chest, barrel）
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

// 移动到箱子位置
async function goToChest(chestBlock) {
  const goal = new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
  await bot.pathfinder.goto(goal)
}

// 从箱子取补给
async function takeSupplies() {
  if (bot.isBusy) {
    bot.chat('I am busy right now.')
    return
  }
  bot.isBusy = true
  bot.pvp.stop() // 停止攻击
  bot.pathfinder.setGoal(null) // 停止移动

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

    // 获取所有食物物品
    const foodItems = bot.autoEat.foodsArray || []
    const foodNames = foodItems.map(f => f.name)

    // 获取所有武器（剑、斧、弓、弩）
    const weaponNames = Object.values(mcData.items)
      .filter(item => item.name.includes('sword') || item.name.includes('axe') || item.name.includes('bow') || item.name.includes('crossbow'))
      .map(item => item.name)

    // 装备类型
    const armorSlots = ['head', 'torso', 'legs', 'feet']
    const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots']

    // 遍历箱子槽位
    for (const item of container.containerItems()) {
      // 食物补给
      if (foodNames.includes(item.name)) {
        const currentCount = bot.inventory.count(item.type, null)
        if (currentCount < 16) { // 食物少于16个则补充
          const need = 16 - currentCount
          const take = Math.min(need, item.count)
          await container.withdraw(item.type, null, take)
          console.log(`Took ${take} ${item.name}`)
        }
      }
      // 武器补给
      else if (weaponNames.includes(item.name)) {
        const hasWeapon = bot.inventory.items().some(i => weaponNames.includes(i.name))
        if (!hasWeapon) {
          await container.withdraw(item.type, null, 1)
          console.log(`Took 1 ${item.name}`)
        }
      }
      // 装备补给
      else if (armorTypes.some(type => item.name.includes(type))) {
        // 简单策略：如果对应槽位为空，则取一件
        for (let i = 0; i < armorSlots.length; i++) {
          if (item.name.includes(armorTypes[i])) {
            const dest = armorSlots[i]
            const current = bot.inventory.slots[bot.getEquipmentDestSlot(dest)]
            if (!current) {
              await container.withdraw(item.type, null, 1)
              await bot.equip(item, dest) // 立即穿上
              console.log(`Equipped ${item.name} in ${dest}`)
            }
            break
          }
        }
      }
    }

    container.close()
    bot.chat('Supplies taken.')
  } catch (err) {
    console.error('Error during restock:', err)
    bot.chat('Failed to restock.')
  } finally {
    bot.isBusy = false
  }
}

// 存入战利品（背包中除装备和快捷栏外的所有物品）
async function depositLoot() {
  if (bot.isBusy) {
    console.log('Bot busy, cannot deposit now.')
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

    // 获取背包槽位范围（排除装备槽和快捷栏）
    const inventoryStart = container.inventorySlotStart // 背包起始索引
    const inventoryEnd = container.inventorySlotEnd     // 背包结束索引
    const hotbarStart = inventoryStart
    const hotbarEnd = inventoryStart + 8                // 快捷栏0-8
    const armorStart = inventoryStart + 5               // 装备槽5-8（头、胸、腿、脚）
    const armorEnd = inventoryStart + 8

    // 遍历背包每个槽位
    for (let slot = inventoryStart; slot <= inventoryEnd; slot++) {
      // 跳过快捷栏和装备槽
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

// 定时器（500秒）
function startAutoDeposit() {
  if (depositInterval) clearInterval(depositInterval)
  depositInterval = setInterval(() => {
    console.log('Auto deposit triggered.')
    depositLoot()
  }, 500 * 1000) // 500秒
}

bot.once('spawn', () => {
  console.log('✅ Bot spawned!')

  const mcData = mcDataLoader(bot.version)
  console.log(`📦 Minecraft version: ${bot.version}`)

  // 配置移动
  const movements = new Movements(bot, mcData)
  movements.allowParkour = true
  movements.canDig = false
  bot.pathfinder.setMovements(movements)
  console.log('🔧 Pathfinder movements configured.')

  // 护甲和自动进食
  bot.armorManager.equipAll()
  console.log('🛡️ Armor equipped.')

  bot.autoEat.enableAuto()
  bot.autoEat.setOpts({
    priority: 'foodPoints',
    minHunger: 14,
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye']
  })
  console.log('🍖 Auto-eat enabled.')

  // 启动自动存储
  startAutoDeposit()
  console.log('⏰ Auto deposit every 500s started.')

  // 列出附近实体
  setTimeout(() => {
    const entities = Object.values(bot.entities)
    console.log(`🌍 Nearby entities (${entities.length}):`)
    entities.forEach(e => {
      console.log(`  - ${e.name || e.type} (${e.type}) at ${e.position.floored()}`)
    })
  }, 2000)
})

// 攻击逻辑
bot.on('physicsTick', async () => {
  if (bot.pvp.target || bot.isBusy) return

  const filter = e => 
    e.type !== 'player' && 
    e.type !== 'object' && 
    e.position.distanceTo(bot.entity.position) < 32

  const target = bot.nearestEntity(filter)

  if (target) {
    console.log(`🎯 Found target: ${target.name || target.displayName} at ${target.position.floored()}`)
    await selectWeaponForTarget(target)
    console.log(`⚔️ Attacking ${target.name || target.displayName}`)
    bot.pvp.attack(target)
  }
})

bot.on('stoppedAttacking', () => {
  console.log('🛑 Stopped attacking')
})

// 武器选择
async function selectWeaponForTarget(entity) {
  const sword = bot.inventory.items().find(item => item.name.includes('sword'))
  if (sword) {
    await bot.equip(sword, 'hand')
    console.log(`🗡️ Equipped sword: ${sword.name}`)
    return
  }
  const axe = bot.inventory.items().find(item => item.name.includes('axe'))
  if (axe) {
    await bot.equip(axe, 'hand')
    console.log(`🪓 Equipped axe: ${axe.name}`)
    return
  }
  console.log('👊 No weapon, using fists.')
}

// 聊天命令
bot.on('chat', (username, message) => {
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
