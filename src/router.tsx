import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload روی hover برای بازدید لندینگ (اینستاگرام) چند درخواست SSR اضافه می‌ساخت
    defaultPreload: false,
    // Preloaded route data تا ۳۰ ثانیه تازه در نظر گرفته می‌شود تا کلیک
    // بلافاصله بعد از hover دوباره fetch نکند.
    defaultPreloadStaleTime: 30_000,
    // برای loaderهای غیر-Query — تازگی داده بین بازدیدها
    defaultStaleTime: 30_000,
  });

  return router;
};
