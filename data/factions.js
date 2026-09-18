/* 阵营 ↔ 国家 映射
 *
 * 游戏里带路条件用的是「阵营名」（如 舰队中<奥鲁加>数量≥4），
 * 而玩家习惯按国家思考，所以这里做一层别名映射，界面上显示成「奥鲁加（德）」。
 *
 * 对应关系依据游戏内「筛选」面板里国籍一览的阵营顺序：
 *   凤棲 / 洛蒙瑞亚 / 尤奈特 / 纳榭尔 / 沃尔克 / 奥鲁加 / 八咫 / 列加杜
 * 依次对应 中 / 英 / 美 / 法 / 苏 / 德 / 日 / 意。
 *
 * 「奥鲁加 = 德」已独立验证：Z2（二战德国驱逐舰）的国籍显示为奥鲁加。
 * 其余按顺序推断；所有阵营名都已放大逐字核对过字形（凤棲是「木+妻」，不是「木+西」）。
 *
 * country 为 null 表示没有对应国家，界面不加后缀。
 * 若发现对应关系有误，直接改 country 即可，其余代码都读这张表。
 */
window.FX_FACTIONS = {
  "凤棲":     { country: "中" },
  "洛蒙瑞亚": { country: "英" },
  "尤奈特":   { country: "美" },
  "纳榭尔":   { country: "法" },
  "沃尔克":   { country: "苏" },
  "奥鲁加":   { country: "德" },
  "八咫":     { country: "日" },
  "列加杜":   { country: "意" },
  // 对应哪国待确认；游戏里目前还没有该阵营的舰灵
  "伽纳伊":   { country: "?" },
  "无阵营":   { country: null }
};

/* 下拉框用的顺序 */
window.FX_FACTION_LIST = Object.keys(window.FX_FACTIONS);

/* 显示名: 「奥鲁加（德）」；没有国家的不加后缀 */
window.FX_FACTION_LABEL = function (name) {
  var f = window.FX_FACTIONS[name];
  if (!f || !f.country) return name;
  return name + '（' + f.country + '）';
};

/* 把条件原文里的 <阵营> 标注上国家: 「舰队中<奥鲁加（德）>数量≥4」 */
window.FX_ANNOTATE_FACTIONS = function (text) {
  if (!text) return text;
  return String(text).replace(/<([^>]+)>/g, function (m, inner) {
    var f = window.FX_FACTIONS[inner];
    return (f && f.country) ? '<' + inner + '（' + f.country + '）>' : m;
  });
};
