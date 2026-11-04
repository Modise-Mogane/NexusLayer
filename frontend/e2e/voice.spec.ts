import { expect, test, type Page } from "@playwright/test";

/* Voice playback lifecycle (queue/lifecycle level, not audible output).
   A speechSynthesis stub records every utterance handed to the synth so the
   tests can prove all segments — including the final one — are delivered,
   survive navigation, and are only cancelled deliberately. */

const STUB = () => {
  const w = window as unknown as Record<string, unknown>;
  // Voice-input-absent profile (mirrors Firefox): Live stays ON as streaming
  // text+TTS instead of dying on headless-Chrome's permission-blocked STT.
  try {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  } catch {
    /* noop */
  }
  w.__nxSpoken = [] as string[];
  w.__nxCancels = 0;
  w.__nxSpeakDelay = 15;
  class FakeUtter {
    text: string;
    rate = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  let current: FakeUtter | null = null;
  (w as Record<string, unknown>).SpeechSynthesisUtterance =
    FakeUtter as unknown as typeof SpeechSynthesisUtterance;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => [],
      speak(u: FakeUtter) {
        (w.__nxSpoken as string[]).push(u.text);
        current = u;
        const delay = Number(w.__nxSpeakDelay ?? 15);
        window.setTimeout(() => {
          if (current === u) u.onstart?.();
        }, 0);
        window.setTimeout(() => {
          if (current === u) {
            current = null;
            u.onend?.();
          }
        }, delay);
      },
      cancel() {
        w.__nxCancels = Number(w.__nxCancels) + 1;
        const cur = current;
        current = null;
        // Chrome fires an error on the interrupted utterance.
        if (cur?.onerror) window.setTimeout(() => cur.onerror?.({ error: "canceled" }), 0);
      },
      pause() {},
      resume() {},
      onvoiceschanged: null,
    },
  });
};

async function speechState(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      mirror: (w.__nxSpeech as { phase: string; segmentCount: number } | undefined) ?? null,
      spoken: (w.__nxSpoken as string[] | undefined) ?? [],
      cancels: Number(w.__nxCancels ?? 0),
    };
  });
}

async function openLiveDrawer(page: Page) {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /Live Assistant/ }).click();
  await expect(page.getByRole("button", { name: /Live Assistant/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const drawer = page.getByRole("complementary", { name: "Live assistant" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Assistant settings" }).click();
  await drawer.getByRole("switch", { name: "Use AI provider" }).click();
  await drawer.getByRole("button", { name: "Assistant settings" }).click();
  return drawer;
}

test("complete spoken response: every segment incl. final, no stray cancel", async ({
  page,
}) => {
  await page.addInitScript(STUB);
  const drawer = await openLiveDrawer(page);
  const before = await speechState(page);
  await drawer.getByLabel("Message the assistant").fill("How is the network performing?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(drawer.getByText(/Network assessment/).first()).toBeVisible({ timeout: 90000 });

  // Multi-sentence deterministic reply => multiple queued utterances.
  await expect
    .poll(async () => (await speechState(page)).spoken.length, { timeout: 30000 })
    .toBeGreaterThan(5);
  // Playback drains to idle on its own.
  await expect
    .poll(async () => (await speechState(page)).mirror?.phase ?? "none", { timeout: 60000 })
    .toBe("idle");

  const after = await speechState(page);
  const spokenText = after.spoken.join(" ");
  // Final sections of the reply reach the synth (not cut off mid-answer).
  expect(spokenText).toMatch(/Recent events|Possible improvement|Application needs/);
  expect(spokenText.length).toBeGreaterThan(500);
  // One cancel comes from send() setup; nothing cancelled mid-playback.
  expect(after.cancels - before.cancels).toBeLessThanOrEqual(1);
  await expect(drawer.getByText("· speaking")).toHaveCount(0);
});

test("speech survives navigation and can be repeated", async ({ page }) => {
  await page.addInitScript(STUB);
  const drawer = await openLiveDrawer(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__nxSpeakDelay = 120;
  });
  await drawer.getByLabel("Message the assistant").fill("How is the network performing?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => (await speechState(page)).spoken.length, { timeout: 90000 })
    .toBeGreaterThan(1);
  const cancelsBefore = (await speechState(page)).cancels;

  // Navigate mid-playback (in-app, client-side): shell-level session must
  // not cancel speech.
  await page.getByRole("link", { name: /Architect/ }).click();
  await expect(page).toHaveURL(/\/architecture/);
  await expect
    .poll(async () => (await speechState(page)).spoken.length, { timeout: 60000 })
    .toBeGreaterThan(5);
  const mid = await speechState(page);
  expect(mid.cancels).toBe(cancelsBefore);
  await expect
    .poll(async () => (await speechState(page)).mirror?.phase ?? "none", { timeout: 90000 })
    .toBe("idle");

  // Repeat re-speaks the last response after navigation.
  const drawer2 = page.getByRole("complementary", { name: "Live assistant" });
  if (!(await drawer2.isVisible())) {
    await page.getByRole("button", { name: "Open assistant conversation" }).click();
  }
  await expect(drawer2).toBeVisible();
  const countBefore = (await speechState(page)).spoken.length;
  await drawer2.getByRole("button", { name: /Repeat last response/ }).click();
  await expect
    .poll(async () => (await speechState(page)).spoken.length, { timeout: 30000 })
    .toBeGreaterThan(countBefore);
  await expect
    .poll(async () => (await speechState(page)).mirror?.phase ?? "none", { timeout: 90000 })
    .toBe("idle");
});

test("new request deliberately interrupts in-flight speech", async ({ page }) => {
  await page.addInitScript(STUB);
  const drawer = await openLiveDrawer(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__nxSpeakDelay = 150;
  });
  await drawer.getByLabel("Message the assistant").fill("How is the network performing?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => (await speechState(page)).spoken.length, { timeout: 90000 })
    .toBeGreaterThan(1);
  const cancelsBefore = (await speechState(page)).cancels;

  // Second request while speaking: exactly one deliberate cancel, then the
  // new answer is spoken coherently to completion.
  await drawer.getByLabel("Message the assistant").fill("Why is this endpoint disconnected?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => (await speechState(page)).cancels, { timeout: 30000 })
    .toBe(cancelsBefore + 1);
  await expect(drawer.getByText("Why is this endpoint disconnected?").first()).toBeVisible({
    timeout: 15000,
  });
  await expect
    .poll(async () => (await speechState(page)).mirror?.phase ?? "none", { timeout: 90000 })
    .toBe("idle");
  const after = await speechState(page);
  expect(after.spoken.join(" ").length).toBeGreaterThan(500);
});

test("text reply works with no speech synthesis support", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
    const w = window as unknown as Record<string, unknown>;
    try {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    } catch {
      /* noop */
    }
  });
  const drawer = await openLiveDrawer(page);
  await drawer.getByLabel("Message the assistant").fill("How is the network performing?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(drawer.getByText(/Network assessment/).first()).toBeVisible({ timeout: 90000 });
  await expect(drawer.getByText("· speaking")).toHaveCount(0);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
