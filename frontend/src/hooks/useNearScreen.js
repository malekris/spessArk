import { useEffect, useRef, useState } from "react";

export default function useNearScreen({
  root = null,
  rootMargin = "400px 0px",
  threshold = 0.01,
  once = true,
} = {}) {
  const ref = useRef(null);
  const [isNearScreen, setIsNearScreen] = useState(false);

  useEffect(() => {
    if (isNearScreen && once) return undefined;

    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setIsNearScreen(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setIsNearScreen(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setIsNearScreen(false);
        }
      },
      { root, rootMargin, threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isNearScreen, once, root, rootMargin, threshold]);

  return [ref, isNearScreen];
}
