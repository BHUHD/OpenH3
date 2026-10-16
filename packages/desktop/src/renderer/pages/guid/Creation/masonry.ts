/** Preserve template order while packing each item into the current shortest column. */
export function creationMasonry(width: number, ratios: string[], narrow: boolean) {
  const columns = narrow ? 2 : Math.max(2, Math.min(8, Math.round((width + 2) / 192)));
  const cardWidth = Math.max(0, (width - (columns - 1) * 2) / columns);
  const heights = Array<number>(columns).fill(0);
  const items = ratios.map((ratio) => {
    const [x, y] = ratio.split(':').map(Number);
    const height = (cardWidth * y) / x;
    const column = heights.indexOf(Math.min(...heights));
    const item = { width: cardWidth, height, left: column * (cardWidth + 2), top: heights[column] };
    heights[column] += height + 2;
    return item;
  });
  return { items, height: Math.max(0, ...heights) - (items.length ? 2 : 0) };
}
