const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const toolPlugin = require('mineflayer-tool').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const mcDataLoader = require('minecraft-data')
const fs = require('fs').promises
const path = require('path')

const STATE_FILE = path.join(__dirname, 'guard_state.json')

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
let guardPos = null
let isMovingToGuard = false

// ------------------ 状态持久化 ------------------
async function saveGuardState() {
  try {
    if (guardPos) {
      await fs.writeFile(STATE_FILE, JSON.stringify({ 
        x: guardPos.x, 
        y: guardPos.y, 
        z: guardPos.z 
      }))
    } else {
      await fs.unlink(STATE_FILE).catch(() => {})
    }
  } catch (err) {
    console.error('Failed to save guard state:', err)
  }
}

async function loadGuardState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8')
    const { x, y, z } = JSON.parse(data)
    return new (require('vec3'))(x, y, z)
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Failed to load guard state:', err)
    return null
  }
}

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

function isTarget(entity) {
  if (!entity) return false
  if (entity.type === 'player') return false
  if (entity.name === 'armor_stand') return false
  if (entity.isInWater) return false
  if (entity.position.y < 60) return false

  const targetTypes = ['hostile', 'passive', 'mob', 'animal']
  return targetTypes.includes(entity.type)
}

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
    console.log('⏭️ Restock skipped: bot is busy or fighting.')
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

    // 逐个取出物品，若背包满则停止
    for (const req of toWithdraw) {
      try {
        await container.withdraw(req.type, null, req.count, req.nbt)
        const itemName = bot.registry.items[req.type]?.name || 'unknown'
        console.log(`Took ${req.count} x ${itemName}`)
      } catch (err) {
        if (err.message && err.message.includes('destination full')) {
          console.log('⚠️ Inventory full, stopping restock.')
          bot.chat('My inventory is full, cannot take more items.')
          break
        } else {
          throw err // 其他错误继续抛出
        }
      }
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

function startAutoRestock() {
  setInterval(() => {
    if (!bot.isBusy && !bot.pvp.target) {
      console.log('🔄 Auto restock triggered.')
      takeSupplies().catch(err => console.error('Auto restock failed:', err))
    } else {
      console.log('⏭️ Auto restock skipped: bot is busy or fighting.')
    }
  }, 60 * 1000) // 每分钟检查一次
}

// ------------------ 值守相关函数 ------------------
async function moveToGuardPos() {
  if (!guardPos || isMovingToGuard) return
  isMovingToGuard = true
  try {
    const goal = new goals.GoalNear(guardPos.x, guardPos.y, guardPos.z, 2)
    await bot.pathfinder.goto(goal)
    console.log('✅ Returned to guard position.')
  } catch (err) {
    if (err.message === 'GoalChanged' || err.message === 'PathStopped') {
      console.log(`⏭️ Move to guard was interrupted (${err.message}).`)
    } else {
      console.error('Error moving to guard position:', err)
    }
  } finally {
    isMovingToGuard = false
  }
}

function startGuarding(pos) {
  guardPos = pos.clone()
  saveGuardState()
  bot.chat(`I will guard this area (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}).`)
  moveToGuardPos()
}

function stopGuarding() {
  if (guardPos) {
    guardPos = null
    saveGuardState()
    bot.chat('Stopped guarding.')
  }
}

// ------------------ 事件监听 ------------------
bot.once('spawn', async () => {
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

  startAutoRestock()
  console.log('🔄 Auto restock every 60s started.')

  // 恢复值守状态
  const savedGuardPos = await loadGuardState()
  if (savedGuardPos) {
    guardPos = savedGuardPos
    bot.chat(`Restored guard position (${guardPos.x.toFixed(1)}, ${guardPos.y.toFixed(1)}, ${guardPos.z.toFixed(1)})`)
    moveToGuardPos()
  }

  setTimeout(() => {
    const entities = Object.values(bot.entities)
    console.log(`🌍 Nearby entities (${entities.length}):`)
    entities.forEach(e => {
      console.log(`  - ${e.name || e.type} (${e.type}) at ${e.position.floored()}`)
    })
  }, 2000)
})

bot.on('physicsTick', async () => {
  if (bot.pvp.target || bot.isBusy) return

  // 值守模式
  if (guardPos) {
    const target = bot.nearestEntity(e =>
      isTarget(e) &&
      e.position.distanceTo(guardPos) < 16 &&
      e.position.distanceTo(bot.entity.position) < 32
    )

    if (target) {
      console.log(`🎯 Guard target: ${target.name || target.type} at distance ${target.position.distanceTo(bot.entity.position).toFixed(1)}`)
      await selectWeaponForTarget(target)
      bot.pvp.attack(target)
      return
    }

    const distToGuard = bot.entity.position.distanceTo(guardPos)
    if (distToGuard > 4 && !isMovingToGuard && !bot.pvp.target) {
      console.log(`⏪ Returning to guard point (${distToGuard.toFixed(1)} blocks away)`)
      moveToGuardPos().catch(err => console.error('Move to guard failed:', err))
    }
    return
  }

  // 自由狩猎模式
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
  if (guardPos && !isMovingToGuard && bot.entity.position.distanceTo(guardPos) > 4) {
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
    stopGuarding()
    bot.chat('Hunting mode activated.')
  }
})

bot.on('error', err => console.error('❌ Bot error:', err))
bot.on('end', reason => {
  console.log('🔌 Bot disconnected:', reason)
  if (depositInterval) clearInterval(depositInterval)
})
