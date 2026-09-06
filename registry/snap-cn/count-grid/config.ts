import { type ComponentConfig, FPS, H, W } from "@/lib/customizer-config";

export const countGridConfig: ComponentConfig = {
  componentName: "CountGrid",
  importPath: "@/components/snap-cn/count-grid",
  controls: {
    from: { type: "text", default: "5", label: "Count before" },
    to: { type: "text", default: "500", label: "Count after" },
    noun: { type: "text", default: "clips", label: "Noun" },
    inkFrom: { type: "color", default: "#1F4470", label: "Label ink (left)" },
    inkTo: { type: "color", default: "#2B84E0", label: "Label ink (right)" },
    background: { type: "color", default: "#FDFDFD", label: "Background" },
    speed: {
      type: "number",
      default: 1,
      min: 0.4,
      max: 2,
      step: 0.05,
      label: "Speed",
    },
  },
  durationInFrames: 47,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
  previewBackdrop: { type: "color", value: "#FDFDFD" },
};
