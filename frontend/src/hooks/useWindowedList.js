import { useEffect, useMemo, useState } from "react";

export default function useWindowedList(items, {
  containerRef,
  estimatedItemHeight = 120,
  overscan = 4,
  enabled = true,
} = {}) {
  const [range, setRange] = useState({
    start: 0,
    end: items.length,
    padTop: 0,
    padBottom: 0,
  });

  useEffect(() => {
    if (!enabled) {
      setRange({
        start: 0,
        end: items.length,
        padTop: 0,
        padBottom: 0,
      });
      return undefined;
    }

    const updateRange = () => {
      const node = containerRef?.current;
      const viewportHeight = window.innerHeight || 800;
      const visibleCount = Math.max(8, Math.ceil(viewportHeight / estimatedItemHeight) + overscan * 2);

      if (!node) {
        setRange({
          start: 0,
          end: Math.min(items.length, visibleCount),
          padTop: 0,
          padBottom: Math.max(0, (items.length - Math.min(items.length, visibleCount)) * estimatedItemHeight),
        });
        return;
      }

      const rect = node.getBoundingClientRect();
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      const containerTop = rect.top + scrollTop;
      const viewportTop = scrollTop;
      const viewportBottom = viewportTop + viewportHeight;
      const visibleStart = Math.max(0, viewportTop - containerTop);
      const visibleEnd = Math.max(0, viewportBottom - containerTop);

      let start = Math.max(0, Math.floor(visibleStart / estimatedItemHeight) - overscan);
      let end = Math.min(items.length, Math.ceil(visibleEnd / estimatedItemHeight) + overscan);

      if (end <= start) {
        end = Math.min(items.length, start + visibleCount);
      }

      setRange({
        start,
        end,
        padTop: start * estimatedItemHeight,
        padBottom: Math.max(0, (items.length - end) * estimatedItemHeight),
      });
    };

    updateRange();
    window.addEventListener("scroll", updateRange, { passive: true });
    window.addEventListener("resize", updateRange);

    return () => {
      window.removeEventListener("scroll", updateRange);
      window.removeEventListener("resize", updateRange);
    };
  }, [containerRef, enabled, estimatedItemHeight, items.length, overscan]);

  const visibleItems = useMemo(
    () => (enabled ? items.slice(range.start, range.end) : items),
    [enabled, items, range.end, range.start]
  );

  return {
    visibleItems,
    startIndex: range.start,
    endIndex: range.end,
    padTop: range.padTop,
    padBottom: range.padBottom,
  };
}
