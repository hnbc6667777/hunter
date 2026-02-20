# Mineflayer Hunter Bot

一个功能强大的 Minecraft 猎杀机器人，基于 [Mineflayer](https://github.com/PrismarineJS/mineflayer) 开发。它可以自动攻击敌对生物、自动进食、自动装备护甲、自动从箱子补充物资、自动存储战利品，并支持值守特定区域。所有状态可持久化，重启后自动恢复。

## 功能特性

- **自动攻击**：自动寻找并攻击 32 格内的敌对/被动生物（可配置过滤条件）。
- **自动进食**：当饥饿值低于阈值时自动吃背包中的食物。
- **自动装备护甲**：从箱子中取出护甲并自动穿上最佳组合。
- **自动补给**：
  - 自动从最近的箱子补充食物（保持至少 16 个）。
  - 自动补充武器（剑、斧、弓、弩）、工具（镐、锹、锄、剪刀等）和盾牌（如果背包中没有）。
- **自动存储战利品**：每 500 秒自动将背包中非快捷栏/装备槽的物品存入最近的箱子。
- **值守模式**：玩家发送 `guard` 命令后，机器人会记录当前位置并在此区域巡逻，攻击进入范围的生物；击杀后自动返回值守点。状态保存到文件，重启后恢复。
- **自由狩猎模式**：默认在全图范围内自动搜索并攻击生物。
- **手动控制**：支持多种聊天命令，可手动触发攻击、补给、存储、扫描等操作。
- **持久化**：值守点保存在 `guard_state.json` 中，重启后自动恢复。

## 安装

### 环境要求
- Node.js 18 或更高版本
- 一个 Minecraft 服务器（支持 1.21.9 及相近版本）

### 步骤

1. 克隆或下载本项目代码。
2. 在项目目录下安装依赖：
   ```bash
   npm install mineflayer mineflayer-pathfinder mineflayer-pvp mineflayer-tool mineflayer-auto-eat mineflayer-armor-manager minecraft-data
   ```
3. 将脚本保存为 `hunter.js`。

## 使用方法

### 启动机器人
```bash
node hunter.js <服务器地址> <端口> [机器人名] [密码]
```
示例：
```bash
node hunter.js localhost 25565 MyBot
```
- 如果服务器为离线模式，可省略密码。
- 机器人名默认为 `Hunter`。

### 聊天命令
在游戏内发送以下命令与机器人交互（`<` 和 `>` 表示参数，不要输入尖括号）：

| 命令 | 说明 |
|------|------|
| `guard` | 将说话者当前位置设为值守点，机器人开始在此区域巡逻。 |
| `stop` | 停止所有活动（攻击、移动、值守），退出值守模式。 |
| `hunt` | 切换到自由狩猎模式，清除值守点。 |
| `attack` | 手动攻击最近的生物（用于测试）。 |
| `restock` | 立即从最近的箱子补充物资。 |
| `deposit` | 立即将背包中非快捷栏/装备槽的物品存入最近的箱子。 |
| `scan` | 在控制台输出附近所有实体的列表及距离。 |

### 自动行为
- **自动攻击**：每 tick 检查一次，自由模式下攻击 32 格内符合条件的生物，值守模式下仅攻击距值守点 16 格内的生物。
- **自动进食**：饥饿值 ≤ 14 时自动吃食物（可配置）。
- **自动补给**：每 60 秒自动执行一次 `restock`，仅在非战斗且非忙碌时进行。
- **自动存款**：每 500 秒自动执行一次 `deposit`，仅在非战斗时进行。

## 配置说明

您可以在代码中调整以下参数：

- **`isTarget` 函数**：修改 `targetTypes` 数组可控制攻击的生物类型；`entity.position.y < 60` 可调整地表过滤高度。
- **自动进食**：`bot.autoEat.setOpts` 中的 `minHunger`、`bannedFood` 等选项。
- **自动补给阈值**：`if (currentCount < 16)` 可修改食物保有量。
- **攻击范围**：`physicsTick` 中的 `32` 和 `16` 可调整搜索距离。
- **值守返回距离**：`if (distToGuard > 4)` 可修改触发返回的距离。

## 依赖模块

- [mineflayer](https://github.com/PrismarineJS/mineflayer) - 核心 Minecraft 机器人库
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) - 路径寻路
- [mineflayer-pvp](https://github.com/TheDudeFromCI/mineflayer-pvp) - PVP 战斗管理
- [mineflayer-tool](https://github.com/TheDudeFromCI/mineflayer-tool) - 工具选择（本项目中用于装备武器）
- [mineflayer-auto-eat](https://github.com/link-discord/mineflayer-auto-eat) - 自动进食
- [mineflayer-armor-manager](https://github.com/G07cha/MineflayerArmorManager) - 自动装备护甲
- [minecraft-data](https://github.com/PrismarineJS/minecraft-data) - Minecraft 数据

## 注意事项

1. **版本兼容性**：本脚本基于 Minecraft 1.21.9 开发，其他版本可能需要调整 `minecraft-data` 的版本或部分物品名称。
2. **箱子位置**：机器人会搜索 32 格内的普通箱子、陷阱箱和木桶。请确保补给箱在附近。
3. **背包空间**：自动补给时若背包已满，会停止取物并提示，不会崩溃。建议定期执行 `deposit` 清理背包。
4. **值守模式**：值守点保存在 `guard_state.json` 文件中，请确保该文件可读写。
5. **性能**：机器人每 tick 执行一次目标搜索，在实体较多的服务器上可能会略微增加 CPU 负载。

## 故障排除

- **机器人不攻击**：检查附近是否有符合条件的生物，使用 `scan` 命令查看实体类型和距离。确认 `isTarget` 函数中的类型列表是否包含该生物。
- **自动补给失败**：检查箱子是否在 32 格内，背包是否有空位。日志会显示具体错误。
- **路径错误**：如出现 `PathStopped` 或 `GoalChanged` 错误，属正常中断，无需处理。
- **事件弃用警告**：`physicTick` 已弃用，代码中已改为 `physicsTick`，警告可忽略。

## 许可证

本项目基于 MIT 许可证开源。

---

如有问题或建议，欢迎提交 Issue 或 Pull Request。