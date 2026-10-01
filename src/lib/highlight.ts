export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

/** Percent box so the highlight tracks the page image at any display size. */
export function highlightStyle(bbox: BBox): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(bbox.x / bbox.pageWidth) * 100}%`,
    top: `${(bbox.y / bbox.pageHeight) * 100}%`,
    width: `${(bbox.width / bbox.pageWidth) * 100}%`,
    height: `${(bbox.height / bbox.pageHeight) * 100}%`,
  };
}
