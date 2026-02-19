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

  // 列出所有附近实体用于调试
  setTimeout(() => {
    const entities = Object.values(bot.entities)
    console.log(`🌍 Nearby entities (${entities.length}):`)
    entities.forEach(e => {
      console.log(`  - ${e.name || e.username || e.type} (${e.type}) at ${e.position.floored()}`)
    })
  }, 2000)
})

bot.on('physicsTick', () => {
  if (bot.pvp.target) {
    // 已经在攻击，可以忽略
    return
  }

  // 寻找 16 格内的生物
  const filter = e => 
  (e.type === 'hostile' || e.type === 'passive' || e.type === 'mob') && 
  e.position.distanceTo(bot.entity.position) < 32 // 扩大搜索范围
  const target = bot.nearestEntity(filter)

  if (target) {
    console.log(`🎯 Found target: ${target.name || target.displayName} at ${target.position.floored()}`)
    selectWeaponForTarget(target).then(() => {
      console.log(`⚔️ Attacking ${target.name || target.displayName}`)
      bot.pvp.attack(target)
    }).catch(err => {
      console.error('⚠️ Weapon selection error:', err)
    })
  } else {
    // 可选：打印调试信息，但频率太高会刷屏，可以降低频率
    // console.log('🔍 No target in range.')
  }
})

bot.on('stoppedAttacking', () => {
  console.log('🛑 Stopped attacking')
})

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

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  console.log(`💬 Chat from ${username}: ${message}`)
  if (message === 'scan') {
  const entities = Object.values(bot.entities)
  console.log(`Nearby entities (${entities.length}):`)
  entities.forEach(e => {
    const dist = e.position.distanceTo(bot.entity.position)
    console.log(`  - ${e.name || e.type} (${e.type}) at ${e.position.floored()}, dist=${dist.toFixed(1)}`)
  })
}
  if (message === 'hunt') {
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
bot.on('end', reason => console.log('🔌 Bot disconnected:', reason))
