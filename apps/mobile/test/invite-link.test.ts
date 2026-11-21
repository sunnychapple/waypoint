import { describe, expect, it } from "vitest";
import { inviteLink, inviteTokenFromText } from "../src/core/share/invite-link.ts";

const TOKEN = "Abc_-0123456789abcdefghijklmnopqrstuvwxyzAB";

describe("inviteLink", () => {
  it("makes the https link on the API host", () => {
    expect(inviteLink("https://api.example.com", TOKEN)).toBe(`https://api.example.com/i#${TOKEN}`);
  });
  it("drops trailing slashes from the API host", () => {
    expect(inviteLink("https://api.example.com/", TOKEN)).toBe(`https://api.example.com/i#${TOKEN}`);
  });
  it("falls back to the app link when no API host is set", () => {
    expect(inviteLink("", TOKEN)).toBe(`waypoint://invite/${TOKEN}`);
  });
});

describe("inviteTokenFromText", () => {
  it("reads the https link", () => {
    expect(inviteTokenFromText(`https://api.example.com/i#${TOKEN}`)).toBe(TOKEN);
  });
  it("reads the https link with a trailing slash, and with surrounding space", () => {
    expect(inviteTokenFromText(`  https://api.example.com/i#${TOKEN}\n`)).toBe(TOKEN);
  });
  it("reads the older path form of the https link", () => {
    expect(inviteTokenFromText(`https://api.example.com/i/${TOKEN}`)).toBe(TOKEN);
  });
  it("reads the app link", () => {
    expect(inviteTokenFromText(`waypoint://invite/${TOKEN}`)).toBe(TOKEN);
  });
  it("reads the bare token", () => {
    expect(inviteTokenFromText(TOKEN)).toBe(TOKEN);
  });
  it("reads a link inside a message", () => {
    expect(inviteTokenFromText(`Join me on NotePath: https://api.example.com/i/${TOKEN} thanks`)).toBe(TOKEN);
  });
  it("rejects a token of the wrong length", () => {
    expect(inviteTokenFromText(TOKEN.slice(1))).toBeNull();
    expect(inviteTokenFromText(`${TOKEN}x`)).toBeNull();
    expect(inviteTokenFromText(`https://api.example.com/i/${TOKEN}x`)).toBeNull();
  });
  it("rejects characters outside the token alphabet", () => {
    expect(inviteTokenFromText(`${TOKEN.slice(0, 42)}+`)).toBeNull();
    expect(inviteTokenFromText(`${TOKEN.slice(0, 42)}=`)).toBeNull();
  });
  it("rejects other text and other schemes", () => {
    expect(inviteTokenFromText("")).toBeNull();
    expect(inviteTokenFromText("hello there")).toBeNull();
    expect(inviteTokenFromText(`http://api.example.com/i/${TOKEN}`)).toBeNull();
    expect(inviteTokenFromText(`waypoint://gate/${TOKEN}`)).toBeNull();
  });
});
