/**
 * تطبیق نام‌های مشابه در ثبت صوتی: اسم کامل کلمه‌به‌کلمه اول است،
 * حداکثر ۵ گزینه دیده می‌شود و بقیه پشت «محصولات بیشتر» می‌مانند.
 * اجرا: npx tsx --tsconfig tsconfig.json scripts/test-voice-product-match.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "../src/lib/store";
import {
  VOICE_PRODUCT_CHOICE_LIMIT,
  isClearProductWinner,
  matchProducts,
  parseVoiceText,
  scoreProduct,
  splitVoiceProductChoices,
} from "../src/lib/voice/persian-nlu";

function p(id: string, name: string): Product {
  return { id, name, price: 10000, category: "پوشاک", code: id, stock: 5 };
}

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("ok:", label);
  else {
    failed++;
    console.error("FAIL:", label, detail ?? "");
  }
}

const similarShirts = [
  p("exact", "تیشرت مشکی"),
  p("l", "تیشرت مشکی لارج"),
  p("m", "تیشرت مشکی مدیوم"),
  p("s", "تیشرت مشکی اسمال"),
  p("white", "تیشرت سفید"),
  p("xl", "تیشرت مشکی ایکس لارج"),
  p("men", "تیشرت مشکی مردانه"),
  p("plain", "تیشرت"),
];

{
  const ranked = matchProducts("تیشرت مشکی", similarShirts);
  check("exact full name is first", ranked[0]?.product.id === "exact", ranked.map((c) => c.product.name));
  check(
    "saying the exact name is a clear winner among similar shirts",
    isClearProductWinner(ranked),
    ranked.slice(0, 3).map((c) => `${c.product.name}:${c.score.toFixed(3)}`),
  );
  const parsed = parseVoiceText("یک تیشرت مشکی", similarShirts);
  check("invoice auto-picks the spoken full name", parsed.items[0]?.confidence === "high");
  check("auto-pick product is تیشرت مشکی", parsed.items[0]?.candidates[0]?.product.id === "exact");
}

{
  const ranked = matchProducts("تیشرت مشکی لارج", similarShirts);
  check("full longer name beats the shorter similar name", ranked[0]?.product.id === "l", ranked.map((c) => c.product.name));
  check("full longer name is a clear winner", isClearProductWinner(ranked));
  const parsed = parseVoiceText("تیشرت مشکی لارج", similarShirts);
  check("spoken full name auto-adds the long product", parsed.items[0]?.confidence === "high");
  check("does not auto-add the short تیشرت مشکی", parsed.items[0]?.candidates[0]?.product.id === "l");
}

{
  const many = [
    p("a", "روغن مایع"),
    p("b", "روغن مایع طبیعت"),
    p("c", "روغن مایع لادن"),
    p("d", "روغن مایع آفتابگردان"),
    p("e", "روغن مایع آفتابگردان طبیعت"),
    p("f", "روغن جامد"),
    p("g", "روغن مایع اویلا"),
    p("h", "روغن مایع بهار"),
  ];
  const ranked = matchProducts("روغن مایع", many);
  check("روغن مایع exact is first", ranked[0]?.product.id === "a");
  check("more than 5 similar names are kept for overflow", ranked.length > VOICE_PRODUCT_CHOICE_LIMIT, ranked.length);
  const { visible, more } = splitVoiceProductChoices(ranked);
  check("UI shows at most 5", visible.length === VOICE_PRODUCT_CHOICE_LIMIT, visible.length);
  check("overflow has the rest", more.length === ranked.length - VOICE_PRODUCT_CHOICE_LIMIT, more.length);
  check("first visible is the spoken full name", visible[0]?.product.name === "روغن مایع");
}

{
  const ranked = matchProducts("روغن مایع آفتابگردان طبیعت", [
    p("short", "روغن مایع"),
    p("mid", "روغن مایع آفتابگردان"),
    p("full", "روغن مایع آفتابگردان طبیعت"),
    p("other", "روغن جامد طبیعت"),
  ]);
  check("word-by-word full phrase wins", ranked[0]?.product.id === "full", ranked.map((c) => c.product.name));
  check(
    "shorter similar names rank after the spoken full name",
    ranked.findIndex((c) => c.product.id === "full") === 0 &&
      ranked.findIndex((c) => c.product.id === "mid") < ranked.findIndex((c) => c.product.id === "short"),
    ranked.map((c) => c.product.name),
  );
}

{
  const glass = [
    p("samsung", "گلس سامسونگ"),
    p("13", "گلس آیفون ۱۳"),
    p("iphone", "گلس آیفون"),
    p("xiaomi", "محافظ صفحه شیائومی"),
  ];
  const ranked = matchProducts("گلس آیفون", glass);
  check("گلس آیفون exact first", ranked[0]?.product.id === "iphone");
  check("گلس آیفون ۱۳ is second (prefix, extra word)", ranked[1]?.product.id === "13", ranked.map((c) => c.product.name));
  check(
    "گلس سامسونگ is not above the full phrase",
    !ranked.some((c) => c.product.id === "samsung") ||
      ranked.findIndex((c) => c.product.id === "samsung") >
        ranked.findIndex((c) => c.product.id === "13"),
    ranked.map((c) => c.product.name),
  );
}

{
  check("شیر is not a string-prefix of شیرینی", scoreProduct("شیر", "شیرینی") < 0.5, scoreProduct("شیر", "شیرینی"));
  const ranked = matchProducts("شیر", [p("milk", "شیر"), p("sweet", "شیرینی خشک"), p("low", "شیر کم چرب")]);
  check("exact شیر beats شیرینی and شیر کم چرب", ranked[0]?.product.id === "milk");
  check("شیر vs similar is still a clear winner", isClearProductWinner(ranked));
}

{
  const sizes = [
    p("1", "روژلب شماره ۱"),
    p("17", "روژلب شماره ۱۷"),
    p("7", "روژلب شماره ۷"),
  ];
  const ranked = matchProducts("روژلب شماره ۱۷", sizes);
  check("spoken number ۱۷ wins over ۱ and ۷", ranked[0]?.product.id === "17", ranked.map((c) => `${c.product.name}:${c.score}`));
  check("wrong numbers are not shown as close matches", !ranked.some((c) => c.product.id !== "17" && c.score > 0.25) || ranked.every((c) => c.product.id === "17" || c.score <= ranked[0].score));
  const parsed = parseVoiceText("روژلب شماره ۱۷", sizes);
  check("numbered full name auto-picks ۱۷", parsed.items[0]?.candidates[0]?.product.id === "17");
}

{
  const onlyVariants = [
    p("l", "تیشرت مشکی لارج"),
    p("m", "تیشرت مشکی مدیوم"),
    p("s", "تیشرت مشکی اسمال"),
    p("xl", "تیشرت مشکی ایکس لارج"),
    p("xxl", "تیشرت مشکی دو ایکس لارج"),
    p("kid", "تیشرت مشکی بچگانه"),
  ];
  const parsed = parseVoiceText("تیشرت مشکی", onlyVariants);
  check("no exact name → ask the user", parsed.items[0]?.confidence === "low", parsed.items[0]?.confidence);
  check("closest prefix (fewest extra words) is first", parsed.items[0]?.candidates[0]?.product.id === "l" || parsed.items[0]?.candidates[0]?.product.name.startsWith("تیشرت مشکی"), parsed.items[0]?.candidates[0]?.product.name);
  check("all similar variants stay available", (parsed.items[0]?.candidates.length ?? 0) === onlyVariants.length);
  const { visible, more } = splitVoiceProductChoices(parsed.items[0]?.candidates ?? []);
  check("five on screen", visible.length === 5);
  check("one leftover behind more", more.length === 1, more.length);
}

{
  const unique = [p("bread", "نان"), p("shirt", "تیشرت")];
  const parsed = parseVoiceText("دو تا نان", unique);
  check("unique catalog name still high confidence", parsed.items[0]?.confidence === "high");
  check("unique product is نان", parsed.items[0]?.candidates[0]?.product.id === "bread");
}

{
  check("empty phrase scores 0", scoreProduct("", "نان") === 0);
  check("empty product scores 0", scoreProduct("نان", "") === 0);
}

{
  const root = dirname(fileURLToPath(import.meta.url));
  const voiceSrc = readFileSync(join(root, "../src/routes/voice.tsx"), "utf8");
  const assistantSrc = readFileSync(join(root, "../src/components/SmartAssistant.tsx"), "utf8");
  const choicesSrc = readFileSync(join(root, "../src/components/VoiceProductChoices.tsx"), "utf8");
  check("voice page uses shared product choices", /VoiceProductChoices/.test(voiceSrc));
  check("assistant uses shared product choices", /VoiceProductChoices/.test(assistantSrc));
  check("more-products label exists", /محصولات بیشتر/.test(choicesSrc));
  check("choice limit is 5", /VOICE_PRODUCT_CHOICE_LIMIT = 5/.test(readFileSync(join(root, "../src/lib/voice/persian-nlu.ts"), "utf8")));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall voice product-match checks passed");
