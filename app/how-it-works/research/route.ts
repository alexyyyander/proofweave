import { pathForLocale } from "@/app/i18n/config";

export function GET(request: Request) {
  const locale = request.headers.get("x-pw-locale") === "zh-CN" ? "zh-CN" : "en";
  const target = pathForLocale("/how-it-works", locale) + "#research";
  return Response.redirect(new URL(target, request.url), 308);
}
