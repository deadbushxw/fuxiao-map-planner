# local/ —— 本机私有数据（不进 git）

这个目录被 `.gitignore` 的 `/local/*` 排除，只有本文件会进仓库。
放自己的东西进来，页面照常能读到，但不会出现在提交里。

## 怎么用

`app/main.js` 启动时按需加载这两个**可选**文件：

```
local/ships.local.js    你自己的舰灵库（赋值 window.FX_SHIPS，覆盖 data/ships.js 的空模板）
local/fleets.local.js   你自己的编队（赋值 window.FX_FLEETS）
```

文件不存在时只是一次 404（浏览器控制台会留一条记录），**不影响启动**，可以忽略。

要让自己的舰灵库进这个私有层：

1. 把 `data/ships.js` 抄一份到 `local/ships.local.js`，开头加一行 `window.FX_LOCAL_SHIPS = 1;`，
   其余保持 `window.FX_SHIPS = [ ... ];` 的形式
2. 界面上改完舰灵库后，「导出 ships.js」下载的文件直接覆盖 `local/ships.local.js`
   （导出文件没有那行标记，手动补上即可；编队同理，覆盖 `local/fleets.local.js`）
3. 刷新页面确认舰灵数还在

> 只是普通使用、不打算把仓库推给别人看的话，**不需要**这一层 ——
> 直接把导出文件覆盖回 `data/ships.js` 就是最简单的用法。

## 为什么不是写死 `<script>` 标签

覆盖层走的是 `app/main.js` 里那套"启动自检 + 补载缺失模块"的机制（见 README「启动排查」）。
写成静态标签时，静态标签偶发不执行就没救了，会静默丢掉整份舰灵库；走补载逻辑才兜得住。

## 这里还适合放什么

- 采集用的原始截图、读图中间产物
- 从自己账号采出来的批量数据（`tools/batches/`、`tools/raw_ships.json` 也已被 gitignore）
- 带本机路径/账号信息的私人笔记
