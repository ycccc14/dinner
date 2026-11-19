// Where to buy each ingredient in Australia, and what it is called on the shelf.
// any = Coles / Woolies / Aldi all have it · cw = Coles / Woolies (Aldi often not) · asian = 中国 / 亚洲超市.
// A 3rd value of 1 means: the big supermarkets have it, but the Asian grocer is usually cheaper or has more choice.
// This is general knowledge, not live stock data — stores and suburbs differ.

export const STORES = {
  any: { name: 'Coles / Woolies / Aldi', short: '大超市', emoji: '🛒' },
  cw: { name: 'Coles / Woolies', short: 'Coles/Woolies', emoji: '🏬' },
  asian: { name: '亚洲超市', short: '亚洲超市', emoji: '🏮' },
  other: { name: '其他', short: '其他', emoji: '🧺' },
};
export const STORE_ORDER = ['any', 'cw', 'asian', 'other'];

const W = {
  // meat & seafood
  鸡翅: ['chicken wings', 'any'], 鸡胸肉: ['chicken breast', 'any'], 鸡腿: ['chicken thigh', 'any'], 鸡: ['whole chicken', 'any'], 鸡肉: ['chicken', 'any'],
  猪肉: ['pork (stir-fry / loin)', 'any'], 猪肉碎: ['pork mince', 'any'], 五花肉: ['pork belly', 'cw', 1], 排骨: ['pork ribs', 'cw', 1], 梅花肉: ['pork scotch fillet', 'cw', 1],
  猪排: ['pork loin steak', 'any'], 猪肚: ['pork stomach', 'asian'], 腊肠: ['Chinese sausage (lap cheong)', 'asian'], 培根: ['bacon', 'any'], 午餐肉: ['luncheon meat (Spam)', 'cw'],
  牛肉: ['beef stir-fry strips', 'any'], 牛腩: ['beef brisket', 'cw', 1], 牛肉碎: ['beef mince', 'any'], 牛排: ['steak', 'any'], 肥牛片: ['shabu beef slices', 'asian'],
  鸭肉: ['duck', 'cw', 1], 虾: ['prawns', 'any'], 虾仁: ['peeled prawns', 'any'], 虾米: ['dried shrimp', 'asian'], 鱼: ['whole fish (snapper / barramundi)', 'cw', 1],
  鱼片: ['white fish fillets', 'any'], 龙利鱼: ['basa fillets', 'any'], 三文鱼: ['salmon fillets', 'any'], 啦啦: ['pipis / clams', 'cw', 1], 江鱼仔: ['dried anchovies (ikan bilis)', 'asian'],
  鱼浆: ['fish paste', 'asian'], 鱼饼: ['fish cake', 'asian'],
  // eggs, tofu, dairy
  鸡蛋: ['eggs', 'any'], 咸蛋: ['salted duck eggs', 'asian'], 皮蛋: ['century eggs', 'asian'], 豆腐: ['firm / silken tofu', 'cw', 1], 豆卜: ['tofu puffs', 'asian'],
  芝士: ['cheese', 'any'], 牛奶: ['milk', 'any'], 淡奶油: ['thickened cream', 'any'], 黄油: ['butter', 'any'],
  // vegetables
  番茄: ['tomatoes', 'any'], 土豆: ['potatoes', 'any'], 胡萝卜: ['carrots', 'any'], 洋葱: ['brown onion', 'any'], 西兰花: ['broccoli', 'any'],
  青椒: ['green capsicum', 'any'], 甜椒: ['red capsicum', 'any'], 黄瓜: ['Lebanese cucumber', 'any'], 西葫芦: ['zucchini', 'any'], 南瓜: ['pumpkin', 'any'],
  茄子: ['eggplant', 'any'], 生菜: ['lettuce', 'any'], 包菜: ['cabbage', 'any'], 卷心菜: ['cabbage', 'any'], 白菜: ['wombok (napa cabbage)', 'any'],
  菠菜: ['baby spinach', 'any'], 芹菜: ['celery', 'any'], 蘑菇: ['mushrooms', 'any'], 香菇: ['shiitake mushrooms', 'cw', 1], 玉米: ['corn', 'any'],
  青豆: ['frozen peas', 'any'], 四季豆: ['green beans', 'any'], 荷兰豆: ['snow peas', 'any'], 豆芽: ['bean sprouts', 'cw', 1], 玉米笋: ['baby corn', 'cw'],
  青菜: ['bok choy / Asian greens', 'cw', 1], 小白菜: ['baby bok choy', 'cw', 1], 菜心: ['choy sum', 'cw', 1], 白萝卜: ['daikon', 'cw', 1], 辣椒: ['chillies', 'any'],
  柠檬: ['lemon', 'any'], 菠萝: ['pineapple', 'any'], 梨: ['nashi pear', 'any'], 九层塔: ['Thai basil', 'asian'], 香茅: ['lemongrass', 'cw'],
  韭菜: ['garlic chives', 'asian'], 青蒜: ['garlic shoots (or leek)', 'asian'], 苦瓜: ['bitter melon', 'asian'], 冬瓜: ['winter melon', 'asian'], 丝瓜: ['luffa / angled gourd', 'asian'],
  老黄瓜: ['old cucumber', 'asian'], 莲藕: ['lotus root', 'asian'], 西洋菜: ['watercress', 'asian'], 空心菜: ['kang kong (water spinach)', 'asian'], 秋葵: ['okra', 'asian'],
  咖喱叶: ['curry leaves', 'asian'], 青木瓜: ['green papaya', 'asian'], 木耳: ['dried black fungus', 'asian'], 海带: ['dried kelp', 'asian'], 紫菜: ['nori / seaweed', 'cw', 1],
  // rice, noodles, wrappers
  米: ['jasmine rice', 'any'], 米饭: ['rice', 'any'], 面条: ['noodles', 'any'], 意面: ['spaghetti', 'any'], 黄面: ['hokkien noodles', 'any'],
  乌冬: ['udon noodles', 'cw'], 米粉: ['rice vermicelli', 'cw'], 河粉: ['rice stick noodles', 'cw'], 粿条: ['fresh flat rice noodles (kway teow)', 'asian'], 泡面: ['instant noodles', 'any'],
  粉丝: ['bean thread vermicelli', 'asian'], 红薯粉: ['sweet potato noodles', 'asian'], 年糕: ['Korean rice cakes (tteok)', 'asian'], 饺子皮: ['gow gee / dumpling wrappers', 'cw', 1],
  汉堡面包: ['burger buns', 'any'], 面包糠: ['panko breadcrumbs', 'any'], 面包丁: ['croutons', 'any'],
  // sauces, pastes, dry goods
  椰浆: ['coconut milk', 'any'], 椰丝: ['desiccated coconut', 'any'], 花生: ['peanuts', 'any'], 花生酱: ['peanut butter', 'any'], 蜂蜜: ['honey', 'any'], 可乐: ['Coke', 'any'], 啤酒: ['beer', 'any'],
  咖喱块: ['Japanese curry roux (Golden Curry)', 'cw'], 韩式辣酱: ['gochujang', 'cw'], 泡菜: ['kimchi', 'cw'], 味噌: ['miso paste', 'cw'], 叉烧酱: ['char siu sauce', 'cw', 1],
  叻沙酱: ['laksa paste', 'cw'], 绿咖喱酱: ['green curry paste', 'any'], 冬阴功酱: ['tom yum paste', 'cw'], 罗望子: ['tamarind puree', 'cw'], 叁巴酱: ['sambal paste', 'asian'],
  虾酱: ['belacan (shrimp paste)', 'asian'], 豆豉: ['fermented black beans', 'asian'], 大酱: ['doenjang (Korean soybean paste)', 'asian'], 梅菜: ['preserved mustard greens', 'asian'],
  酸菜: ['pickled mustard greens', 'asian'], 菜脯: ['preserved radish', 'asian'], 蜜枣: ['candied dates', 'asian'], 红枣: ['red dates (jujube)', 'asian'], 肉骨茶包: ['bak kut teh spice pack', 'asian'],
  // pantry seasonings (only on the list when "购物清单也加调料" is on)
  姜: ['ginger', 'any'], 蒜: ['garlic', 'any'], 葱: ['spring onions', 'any'], 盐: ['salt', 'any'], 油: ['oil', 'any'], 糖: ['sugar', 'any'], 醋: ['black vinegar', 'cw', 1],
  酱油: ['soy sauce', 'any'], 蚝油: ['oyster sauce', 'cw', 1], 冰糖: ['rock sugar', 'asian'], 黑胡椒: ['black pepper', 'any'], 白胡椒: ['white pepper', 'cw'],
  干辣椒: ['dried chillies', 'cw', 1], 淀粉: ['cornflour', 'any'], 味醂: ['mirin', 'cw'], 米酒: ['Shaoxing wine', 'cw', 1], 番茄酱: ['tomato sauce / ketchup', 'any'],
  芝麻: ['sesame seeds', 'any'], 蒸鱼豉油: ['seasoned soy for fish', 'asian'], 豆瓣酱: ['chilli bean paste (doubanjiang)', 'asian'], 黄豆酱: ['yellow soybean paste', 'asian'],
  辣椒油: ['chilli oil', 'cw', 1], 迷迭香: ['rosemary', 'any'], 咖喱粉: ['curry powder', 'any'], 面粉: ['plain flour', 'any'], 枸杞: ['goji berries', 'asian'],
};
const KEYS = Object.keys(W).sort((a, b) => b.length - a.length);

/** { en, store, cheaper } for an ingredient name ('2个番茄' finds 番茄), or null if unknown. */
export function whereToBuy(name) {
  const n = String(name || '').trim();
  const k = W[n] ? n : KEYS.find((x) => x.length >= 1 && n.includes(x) && (x.length >= 2 || n.length <= 3));
  if (!k) return null;
  const [en, store, cheaper] = W[k];
  return { key: k, en, store, cheaper: !!cheaper };
}
export const storeOf = (name) => (whereToBuy(name) || { store: 'other' }).store;
