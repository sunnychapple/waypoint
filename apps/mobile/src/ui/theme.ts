import { useColorScheme } from "react-native";

// Colour tokens from the design file (01 · Foundations · Color). Names match the tokens there.
export const light = {
  bg: "#F7F3EB", surface: "#FFFFFF", surface2: "#F0EBE0", surface3: "#E6E0D2",
  line: "#E5DFD1", lineStrong: "#CEC6B4",
  ink: "#1B1915", ink2: "#4D4940", ink3: "#6F6A5C", ink4: "#A59F8F",
  accent: "#3B34D6", accentStrong: "#2C26B8", accentSoft: "#E8E6FC", onAccent: "#FFFFFF",
  rec: "#EE4B3C", recSoft: "#FDE6E2", onRec: "#FFFFFF",
  flag: "#F4A800", flagSoft: "#FFF0C7", flagInk: "#7A5200",
  local: "#2B8A57", localSoft: "#DDF2E5", localInk: "#1B6B40",
  cloud: "#1C84D4", cloudSoft: "#DDEEFB", cloudInk: "#0F5C9A",
  danger: "#C6362B", dangerSoft: "#FBE3E0",
} as const;

export type Colors = { readonly [K in keyof typeof light]: string };

export const dark: Colors = {
  bg: "#11100E", surface: "#1A1917", surface2: "#232220", surface3: "#2D2B28",
  line: "#34322D", lineStrong: "#4B4841",
  ink: "#F6F2EA", ink2: "#CBC5B7", ink3: "#9F9889", ink4: "#6B665A",
  accent: "#9993FF", accentStrong: "#B3AEFF", accentSoft: "#2A2766", onAccent: "#12104A",
  rec: "#FF6A5B", recSoft: "#3B1D19", onRec: "#11100E",
  flag: "#FFC53D", flagSoft: "#3A2D0B", flagInk: "#FFD982",
  local: "#5BCB8A", localSoft: "#15301F", localInk: "#93E3B3",
  cloud: "#5EB5F6", cloudSoft: "#122A3F", cloudInk: "#A1D4FA",
  danger: "#FF7C6C", dangerSoft: "#3A1C18",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
