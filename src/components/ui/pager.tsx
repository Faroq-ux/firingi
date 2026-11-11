import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Previous / next links for paged lists (keeps the other query parameters). */
export async function Pager({ page, pageCount, basePath, params = {} }: { page: number; pageCount: number; basePath: string; params?: Record<string, string | undefined> }) {
  const c = await getTranslations("common");
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter((e): e is [string, string] => !!e[1]));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground" aria-label={c("pageOf", { page, count: pageCount })} data-testid="pager">
      <span>{c("pageOf", { page, count: pageCount })}</span>
      {pageCount > 1 && (
        <span className="flex gap-2">
          {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page - 1)} rel="prev"><ChevronLeft className="size-4" aria-hidden />{c("previous")}</Link> : null}
          {page < pageCount ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page + 1)} rel="next">{c("next")}<ChevronRight className="size-4" aria-hidden /></Link> : null}
        </span>
      )}
    </nav>
  );
}
