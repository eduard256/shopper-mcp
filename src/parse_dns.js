// Чистые парсеры innerText страниц DNS (без сети). Формат страницы отзывов:
//   "4.33\n2 отзыва" ... "С видео 0\n<n5>\n<n4>\n<n3>\n<n2>\n<n1>" ... затем блоки отзывов:
//   "<Автор>\n<дд.мм.гггг>\nDns-shop.ru\nОбщая:\n<оценка>\n...Срок использования:<...>\nДостоинства\n\n<...>\n\nНедостатки\n\n<...>\n\nКомментарий\n\n<...>\n\n<n>\nКомментировать"

const DATE = /^\d{2}\.\d{2}\.\d{4}$/;

export function parseDnsOpinions(text, limit = 20) {
  const lines = text.split("\n").map((l) => l.trim());
  const head = text.match(/(\d[.,]\d+)\s*\n\s*(\d+)\s*отзыв/);
  const rating = head ? Number(head[1].replace(",", ".")) : null;
  const total = head ? Number(head[2]) : null;
  let distribution = null;
  const vi = lines.findIndex((l) => /^С видео \d+$/.test(l));
  if (vi > 0) {
    const nums = lines.slice(vi + 1, vi + 6);
    if (nums.length === 5 && nums.every((n) => /^\d+$/.test(n))) distribution = { 5: +nums[0], 4: +nums[1], 3: +nums[2], 2: +nums[3], 1: +nums[4] };
  }
  const reviews = [];
  for (let i = 1; i < lines.length && reviews.length < limit; i++) {
    if (!DATE.test(lines[i]) || lines[i + 1] !== "Dns-shop.ru") continue;
    const author = lines[i - 1];
    const date = lines[i].split(".").reverse().join("-");
    let j = i + 2;
    const scores = {};
    while (j < lines.length && /:$/.test(lines[j]) && /^\d(\.\d)?$/.test(lines[j + 1] || "")) {
      scores[lines[j].replace(/:$/, "")] = Number(lines[j + 1]);
      j += 2;
    }
    const end = lines.findIndex((l, k) => k > j && l === "Комментировать");
    const block = lines.slice(j, end === -1 ? j + 60 : end);
    const section = (name) => {
      const s = block.indexOf(name);
      if (s === -1) return "";
      const next = block.findIndex((l, k) => k > s && /^(Достоинства|Недостатки|Комментарий)$/.test(l));
      return block.slice(s + 1, next === -1 ? undefined : next).filter((l) => l && !/^\d+$/.test(l)).join(" ").trim();
    };
    const usage = block.find((l) => /^Срок использования:/.test(l))?.replace(/^Срок использования:/, "").trim() || null;
    reviews.push({ author, date, score: scores["Общая"] ?? null, scores, usage, pros: section("Достоинства"), cons: section("Недостатки"), comment: section("Комментарий") });
    i = end === -1 ? j : end;
  }
  return { rating, totalReviews: total, distribution, count: reviews.length, reviews };
}

