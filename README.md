# Minecraft 猎人机器人 (Hunter Bot)

基于 [Mineflayer](https://github.com/PrismarineJS/mineflayer) 的自动化机器人，用于在 Minecraft 服务器中自动狩猎、收集资源、自动补给和存储战利品。

## 功能特点

- 🎯 **自动狩猎**：自动搜索并攻击附近的敌对/被动生物（支持自定义过滤）
- ⚔️ **智能武器选择**：优先使用剑，其次斧，无武器时使用工具（如镐）或空手
- 🍖 **自动进食**：使用 [mineflayer-auto-eat](https://github.com/LinkleKyle/mineflayer-auto-eat) 插件，饥饿时自动吃食物
- 🛡️ **自动穿戴护甲**：使用 [mineflayer-armor-manager](https://github.com/G07cha/MineflayerArmorManager) 插件，自动装备最佳护甲
- 📦 **箱子补给**：通过指令 `restock` 从最近箱子补充食物、武器、工具、盾牌（按需取用）
- 🗃️ **自动存储**：每500秒自动将背包中的战利品存入最近箱子（非快捷栏/装备槽）
- 🧠 **智能目标过滤**：只攻击地表及非水中生物（可配置）
- ⌨️ **聊天控制**：支持多种游戏内指令，方便调试和管理

## 安装

### 环境要求
- [Node.js](https://nodejs.org/) (v18 或更高)

### 步骤
1. 克隆或下载本项目
2. 安装依赖
```bash
npm install mineflayer mineflayer-pathfinder mineflayer-pvp mineflayer-tool mineflayer-auto-eat mineflayer-armor-manager minecraft-data
```

## 使用方法

```bash
node hunter.js <服务器IP> <端口> [<用户名>] [<密码>]
```

示例：
```bash
node hunter.js localhost 25565 MyBot
```

- 如果服务器为离线模式，只需提供用户名（密码可省略）
- 如果为正版服务器，需同时提供用户名和密码（Microsoft 账户暂不支持密码方式，请使用 `auth` 选项自行修改）

## 游戏内指令

在游戏聊天框发送以下指令控制机器人：

| 指令 | 说明 |
|------|------|
| `restock` | 前往最近箱子补充食物、武器、工具和盾牌（按需取用） |
| `deposit` | 手动将背包物品存入最近箱子（排除快捷栏和装备槽） |
| `attack` | 攻击最近的可攻击生物（优先使用剑/斧） |
| `scan` | 列出附近所有实体及其距离（调试用） |
| `come` | 让机器人移动到说话者位置 |
| `hunt` | 激活自动狩猎模式（默认开启） |
| `stop` | 停止所有行动（停止攻击和移动） |

## 配置说明

您可以根据需要修改脚本中的以下参数：

- **攻击范围**：`< 32` 在 `physicsTick` 中调整
- **自动存储间隔**：`500 * 1000` 毫秒（500秒）可修改
- **目标过滤**：修改 `isTarget` 函数中的条件（如高度、是否在水中、生物类型等）
- **食物补充阈值**：在 `takeSupplies` 中修改 `16` 为所需数量
- **工具/武器类型**：修改 `toolBaseNames` 和 `weaponNames` 数组

## 注意事项

- 箱子必须在机器人周围 **32 格内** 才能被找到
- 自动存储会跳过快捷栏（0-8）和装备槽（5-8），只存背包物品
- 机器人在执行 `restock` 或 `deposit` 时会暂时停止战斗，操作完成后恢复
- 如果服务器有反作弊插件，可能需要调整移动参数（如 `movements.canDig = false`）
- 请确保机器人有权限打开箱子和攻击生物（某些服务器可能有限制）

## 许可证

[MIT](LICENSE)
