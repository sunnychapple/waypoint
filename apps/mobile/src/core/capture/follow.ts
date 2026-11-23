const END_MARGIN = 40;

// True when the scroll position is at the newest line, give or take a small margin.
export function isAtEnd(position: { contentHeight: number; offsetY: number; viewHeight: number }): boolean {
  return position.contentHeight - (position.offsetY + position.viewHeight) < END_MARGIN;
}
