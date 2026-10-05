# Freebuff UI

A colour theme editor for **Freebuff Desktop** for Windows.

> **This is an unofficial extension.**
> It is a community project. It is **not made by, affiliated with, or endorsed by
> Freebuff** or its developers. Use it at your own risk, and please do not ask the
> Freebuff team for support with it. Problems and ideas belong in this repository's
> issue tracker.
> The Theme Studio page repeats this in its header so nobody has to guess where it
> came from.

Once installed, Freebuff gets a new palette icon in its sidebar. Clicking it opens a
Theme Studio page inside the app, where you can change every colour Freebuff uses,
pick from ready-made themes, and save your own.

You do not need to know how to code to use it.

---

https://github.com/user-attachments/assets/6c9b741f-3b19-4529-8625-d19bba4dfdb3

---

## What you get

- A **palette icon** in Freebuff's left sidebar, next to the other icons.
- A **Theme Studio page** that opens inside Freebuff, the same way its Settings page does.
- **15 ready-made themes**: Nord, Dracula, Tokyo Night, Gruvbox, One Dark, Catppuccin
  (dark and light), Rose Pine, Solarized Light, Cyberpunk, Matrix, Amber CRT, Vaporwave,
  Midnight Blue, High Contrast, and the original Freebuff look.
- **A preview of every theme**: each one is drawn as a miniature of the Freebuff window
  in its own colours, so you can pick by eye instead of by name.
- **Dials** for hue, saturation, brightness, contrast and text, which retune the whole
  palette at once when no preset is quite right.
- **Full colour control**: change any of the 212 colours Freebuff uses, one by one.
- **Gradients**: any surface can be a flat colour, a straight gradient or a radial one.
- **Layout control**: corner roundness, text size, fonts, and panel sizes.
- **Your own logo**: replace Freebuff's mark with an SVG, PNG or JPG.
- **A background picture**, with fit, position, opacity and dimming. It travels inside
  the theme file, so nothing needs hosting.
- **Colours survive restarts.** Layout, gradients, window buttons, the chosen preset and
  the raw CSS box are all remembered when you close and reopen Freebuff. A background
  picture or a logo lasts for the session - see
  [Logo and background](#logo-and-background) for why, and how to keep one for good.
- **Window buttons**: set the colour of the minimise, maximise and close buttons in the
  corner, which follow the theme out of the box but can be overridden on their own.
- **Community themes**: a tab of themes other people have made, and a one-click way to
  send in your own.
- **A raw CSS box** for anything the controls do not cover.
- **A custom `.fbtheme` file** you can save, send to someone and open again, plus a
  one-line share code for pasting into a chat.
- **Drag and drop**: drop a `.fbtheme` file on the page and it opens.
- **A/B slots** in the bottom bar: two themes side by side, one click apart, so you can
  compare a change against what you had.

Your theme is remembered after you close and reopen Freebuff.

---

## Requirements

- Windows 10 or 11.
- Freebuff Desktop installed.
- That is all. The installer is a single `.exe` file with nothing else to download.

---

## How to install

1. Download `FreebuffThemeInjector.exe`.
2. Double-click it. A black window appears and prints a short report.
3. When it says **Done**, open Freebuff. If Freebuff is already open, press `Ctrl+R`.

You should now see the palette icon in the sidebar. Click it to open Theme Studio.

The window you see is only open for a few seconds; you can close it by pressing a key.

---

## How to use it

Click the **palette icon** in the sidebar. The Theme Studio page fills the workspace area,
with eight tabs across the top: **Presets**, **Community**, **Colors**, **Layout**,
**Logo and background**, **Advanced**, **Export** and **Settings**. Each tab is a stack of
boxes, and each box holds one kind of control.

Changes apply as you make them and are saved on their own. There is no save button.

### Presets

The first box is a scrollable wall of themes. Every card is a small drawing of the
Freebuff window wearing that theme, with its name underneath. Click one to apply it to the
whole app; the one in use is outlined. **Freebuff Default** puts the original colours back.

**Adjustments** is a row of five dials that retune whatever palette is loaded:

| Dial | What it does |
| --- | --- |
| Hue | Turns every colour around the colour wheel, up to half a turn either way |
| Saturation | Makes the palette more colourful, or drains it towards grey |
| Brightness | Lifts or lowers every colour |
| Contrast | Pushes colours away from the middle, or towards it |
| Text | Lifts or lowers text and muted text on their own |

Drag a dial up or down, scroll on it, or click it and use the arrow keys. Hold `Shift`
for bigger steps. Double-click a dial to put it back to the middle, or use **Reset** in the
box header to reset all five at once.

**Colour spots** puts the colours people change most often on round spots, in five rows
by job:

| Row | Spots |
| --- | --- |
| Surfaces | Background, Chrome, Sidebar, Surface, Surface 2, Raised |
| Text | Text, Muted, Faint, Accent text, Button text |
| Brand | Brand, Brand light, Brand tint, Brand dim, Primary action, Links |
| Lines and status | Border, Ok, Warning, Danger, Info |
| Code | Comment, Keyword, String, Number, Function, Type, Property |

Click a spot and a small colour picker opens next to it: a square for the shade, a strip
for the hue, an opacity slider and a box for typing an exact colour code. Reset hands the
colour back to the preset; Done and `Esc` close the picker. You can also right-click a
spot to hand that colour back straight away. A spot that you have changed keeps a ring
around it, so you can see at a glance what you have overridden. **Reset** in the box header
clears every spot override at once.

The picker also has a **Fill** row. **Solid** is the normal flat colour; **Linear** and
**Radial** turn the same thing into a gradient. A gradient has two stops, **A** and **B**,
and the square, the hue strip and the opacity slider always edit whichever stop is
selected, so changing the second colour is one click. **Angle** only shows for a linear
fill. Anything you can put a colour on, you can put a gradient on: backgrounds, panels,
chrome, borders, and the window buttons.

A few spots cover more than one colour: Brand sets both brand shades, Background sets the
app background and the workspace, and so on.

**All colours** in the box header jumps to the Colors tab, which has every colour
Freebuff uses plus a search box in the Advanced tab.

**Options** is the app's own light or dark preference. Auto, Dark and Light only tell
Freebuff how to draw things it controls itself, such as scrollbars and dropdown menus.
The palette above does not depend on it.

### Colors

This is where you fine-tune. Colours are grouped so you can find what you want:

| Group | What it changes |
| --- | --- |
| Surfaces | Backgrounds and panels |
| Text | All text, from headings to faint hints |
| Brand | The accent colour and buttons |
| Borders | Lines and dividers |
| Status | Success, warning, error, and similar colours |
| Syntax | Colours used in code blocks |
| Effects | Shadows and focus outlines |

Each row has a colour swatch, a slider for transparency, a box for typing an exact
colour code, and a small arrow button to reset just that one colour. Clicking the swatch
opens the same picker as the spots on the Presets tab, and whatever you pick is typed back
into the row.

Changes appear as you make them. There is no save button.

### Community

Themes made by other people, shipped inside the extension. Each one is drawn as a
miniature in its own colours, with who made it underneath and a line about it on hover;
click it to apply it. Because a community theme replaces whatever you are editing, save
yours first if you want to keep it.

**Submit your own** is the same tab, further down: set the theme name, press **Save
.fbtheme**, then press **Open the submission page**. That opens a GitHub form in your
browser with the details already filled in - drag the `.fbtheme` file into the issue and
press Submit. There is a **Copy share code** button too, if you would rather paste the
theme into the issue instead of attaching a file.

The list is a plain data file (`injector/assets/community-themes.js`), so a theme can also
be sent as a pull request. Community themes ship with each release, which is why the tab
works with no internet connection.

### Layout

Rounding presets let you go from sharp square corners to very round ones. Text scale
buttons resize all the text at once. Below those you can set the fonts and set exact
sizes for individual elements.

The rounding buttons set *every* corner Freebuff has, including the workspace box, the
settings page and its cards, popups and the tab strip. **Square** also squares off the
fully-round shapes such as avatars and pills; the other three leave those round, which is
usually what you want. Every individual corner is listed under **Radii** if you would
rather set them one at a time.

### Logo and background

**Freebuff logo** replaces the mark Freebuff draws on the new-thread screen, the loading
screen, the splash and the project sidebar wordmark. Pick any SVG, PNG, JPG, GIF or WebP
file. **Size** scales it and **Opacity** fades it - note that some of those places are
watermarks that Freebuff draws very faint on purpose, so a replacement is faint there too.
**Filter** takes any CSS filter, for example `invert(1)` to flip a black logo white.

**Background picture** puts a picture behind the workspace, or behind the whole window if
you set **Where** to *Whole window*. **Fit** decides whether it fills, fits, tiles or
stretches; **Position** anchors it; **Opacity** lets the theme colour through and **Dim**
adds a dark veil over it.

The picture is stored inside the theme, so it is carried by a `.fbtheme` file and needs no
hosting anywhere. Big pictures are scaled down on the way in - to about 150 KB, at most
2560 pixels on the long side - so nothing enormous is ever handed to the renderer.

**A picture lasts for the session.** Freebuff serves its window from a new local port every
time it starts, and the only storage that survives that is cookies - which are sent with
every request the app makes. A picture big enough to be worth having would be a hundred
times larger than the app can carry, and the app's own server starts refusing requests
once its headers get too big, which leaves the window blank. So pictures are kept where
they cannot hurt: colours and layout are remembered between launches, a picture is not.

To keep a picture for good, either **Export** the theme to a `.fbtheme` file and open it
again when you want it, or bake it into the install with the installer -
`FreebuffThemeInjector.exe --theme my-theme.fbtheme` makes it part of Freebuff itself, so it
comes back on every launch with no cookies involved.

Setting a colour's opacity to anything below fully solid lets the app behind it show
through, which is the point - but Theme Studio itself stays opaque, so its controls never
become hard to read. That is deliberate: the editor is where you work.

**Window buttons** are the minimise, maximise and close buttons in the top-right corner.
They have no colour setting of their own in Freebuff - they just follow the theme's faint
text colour - so this box exists to set them directly: the icon colour, the hover
background and icon, and the close button's hover colours. Leave one alone (it shows
*theme*) and it keeps following the theme.

### Advanced

Two things live here:

1. **A raw CSS box.** If you know CSS, you can type any rules you like and they will be
   applied. This can change things the other sections do not reach.
2. **A list of every colour Freebuff has.** There is a search box at the top and the list
   scrolls on its own. Use this if you are looking for something specific.

### Export

Give your theme a name, then use the three groups of controls on this page.

**This theme** is what you are looking at right now, written out. It keeps up with your
changes as you make them, and it is read-only - it is output, not input.

- **Save .fbtheme** writes a `.fbtheme` file. That is the file to send to someone.
- **Copy theme** puts the same text on your clipboard.
- **Copy CSS** puts the theme on your clipboard as plain CSS, for a stylesheet.

**Share code** is the same theme squeezed onto one line. It is the easiest thing to paste
into Discord, a chat, or a GitHub issue, because nothing can mangle it. Press **Copy** to
take it.

**Open a theme** is the box you type or paste into. It is yours: nothing the page does
ever overwrites it.

- **Import** reads whatever is in that box: a share code, the contents of a `.fbtheme`
  file, or an older saved theme. All three work.
- **Choose a file** opens a file picker so you can pick a `.fbtheme` file directly.

You can also drag a `.fbtheme` file from your desktop and drop it anywhere on the Theme
Studio page. The page highlights the box and opens the theme.

### The bottom bar

- **A** and **B** are two slots holding a whole theme each. **B** is where you are now.
  Press **A** and you are looking at the other one; press **B** to come back. Every edit
  goes to whichever slot is showing, so you can turn one into a variant and flick between
  them without losing either.
- **Reset all** puts everything back to the original Freebuff colours.
- **Check for updates** asks GitHub whether a newer version of this tool exists.
- The text on the right reminds you where to find this page again, and repeats that
  this is an unofficial extension.

Press `Esc` to leave the page. Clicking any other sidebar icon also leaves it.
If you ever need to reopen it without the mouse, press `Ctrl+Alt+Shift+F`.

---

## Updating

The tool checks for a newer release on its own, at most once an hour, and keeps checking
while it is open. You can also ask it to check right away with **Check for updates** in the
bottom bar of the page, or by clicking the version line in the header.

The version line doubles as the status: `v1.3.0 · Tokyo Night` is normal, `checking…`
means a check is running, and `offline` means none of the three mirrors could be reached -
click it to try again. A manual check always reports back, either with the update window
or with a short "You are on the latest version" message.

When a newer release exists, a small window appears with two choices:

- **Update** opens the release page in your browser, where you can download the new
  installer. Nothing is downloaded on its own, and your theme is not touched.
- **Skip this version** closes the window and puts a small **Update** button in the
  bottom-right corner instead. Click that button any time to see the window again.

If you skip, the corner button stays for that version and the window does not come back
on its own. The next release asks again. `Esc` closes the window without deciding, which
is the same as choosing "later".

To install the new version, run the new `FreebuffThemeInjector.exe` the same way you ran
the first one. You do not need to remove anything first, and your theme is kept.

### Settings

Everything that is about the editor rather than the colours:

- **Light and dark** - whether a theme may switch Freebuff's own appearance to match its
  palette (on by default), and the dark/light choice for the app's own controls.
- **Updates** - turn the quiet hourly version check on or off, check right now, see when
  the last check ran, and forget a version you chose to skip.
- **Storage** - how much of the stored-theme budget is in use, a **Save now** button, and a
  way to drop the same-session cache.
- **Delete** - **Delete Theme Studio** removes the whole thing, after a confirmation: your
  theme, every saved setting and every style the page wrote into Freebuff, and then the
  panel, the engine and the community file from the install folder, with Freebuff's own
  `index.html` put back.

  A page is not allowed to delete files, so the button does the half it can and asks the
  background guard to do the rest, which takes one pass - about fifteen seconds. Freebuff
  closes while that happens, because Chromium keeps the cookie jar in memory and would
  otherwise write the deleted theme straight back; it opens again as stock Freebuff. If no
  guard is running, the same removal is one command, and the dialog can copy it for you:
  `FreebuffThemeInjector.exe --uninstall`.

---

## Sharing a theme

A theme file is a small text file like this:

```json
{
  "v": 1,
  "name": "Midnight Blue",
  "preset": "midnight",
  "colors": { "--brand-2": { "hex": "#5b8cff", "a": 1 } },
  "layout": { "--radius-md": "12px" },
  "gradients": {
    "--workspace-surface": {
      "type": "linear", "angle": 160,
      "from": { "hex": "#101018", "a": 1 },
      "to": { "hex": "#1d1d33", "a": 1 }
    }
  },
  "background": {
    "image": "data:image/png;base64,...",
    "fit": "cover", "position": "center", "opacity": 0.8, "dim": 0.4, "whole": false
  },
  "logo": { "image": "data:image/svg+xml,...", "size": 1, "opacity": 1, "filter": "" },
  "window": { "ink": "", "hoverBg": "", "hoverInk": "", "closeBg": "", "closeInk": "" },
  "raw": "",
  "scheme": "",
  "settings": { "followThemeAppearance": true, "autoUpdate": true }
}
```

Every section is optional, so files written by older versions still open. The `background`
and `logo` images are inline data URLs, which is what makes a theme with a picture in it a
single self-contained file.

A `.fbtheme` file is that theme inside a small wrapper, so the file can say what it is:

```json
{
  "format": "fbtheme",
  "formatVersion": 1,
  "app": "Freebuff Theme Studio v1.2.1",
  "created": "2026-10-01T12:00:00.000Z",
  "theme": { "v": 1, "name": "Midnight Blue", "preset": "midnight", "colors": {}, "layout": {} }
}
```

Three ways to give a theme to someone, easiest first:

1. Press **Copy** next to **Share code** and paste the line into a chat. That is the whole
   theme, one line, and it is what most people will want.
2. Press **Save .fbtheme** and send the file. Good for a file host, a repository, or an
   attachment that has to survive a few hops.
3. Paste the JSON from **This theme** wherever long text is welcome.

To use someone else's theme, put it in the **Open a theme** box and press **Import**, or
click **Choose a file** and pick a `.fbtheme` file, or drop the file on the page.

---

## Removing it

The **Settings** tab has a **Delete Theme Studio** button that removes it from inside
Freebuff: confirm once, and the background guard clears the stored theme, deletes the
editor, restores the original file and then removes itself - its files and its logon
entry. Freebuff closes to finish the job and opens again as stock Freebuff.

From a terminal, `FreebuffThemeInjector.exe --uninstall` runs exactly the same removal and
is what to use if the guard is not running. Either way the palette icon goes, the editor
and the community file are deleted, the original file is put back exactly as it was, and
the stored theme is cleared out of Freebuff's cookie jar, so nothing is left behind.

---

## If something goes wrong

**The palette icon is not there.**
Press `Ctrl+R` in Freebuff. If that does not help, close Freebuff completely and open it
again. Reloading the page is what makes Freebuff pick up the new file.

**It worked before, then stopped after a Freebuff update.**
Freebuff updates replace the interface file, which removes the icon. A background guard
puts it back on its own within about twenty seconds of the update - see
[Surviving a Freebuff update](#surviving-a-freebuff-update). If the panel is still
missing, run `FreebuffThemeInjector.exe` again; it is safe to run as many times as you
like and never creates duplicates.

**How do I know the guard is there?**
`FreebuffThemeInjector.exe --status` says so, and `--remove-watch` takes it away again
(logon entry, process and files, in one command).

**I want to start over.**
Use **Reset all** in the bottom bar of the page, or run
`FreebuffThemeInjector.exe --reset-theme` to clear the stored theme entirely.

**My theme is there but the window buttons / logo / background do not look right.**
Check the **Logo and background** tab first: each group has a **Reset** in its header
that hands that part back to the theme.

**My theme did not come back after a restart.**
Press `Ctrl+R` and check again. Freebuff picks a different local port every time it
starts, so anything the page can only see from one port is gone - which is why themes are
saved in the browser's cookie store for Freebuff itself rather than in page storage.
If the panel says a theme could not be read, nothing has been overwritten: the stored copy
is still there, and an untouched default is never saved over it.

**A background picture or logo is gone after a restart.**
That is the design, and it is deliberate - see
[Logo and background](#logo-and-background). Colours, layout and gradients come back.

**Freebuff opens on an empty grey window and nothing brings it back.**
This was caused by an older version of the editor saving a picture into cookies: those
cookies are sent with every request, and the app's own web server refuses a request whose
headers are too big, so the window never renders - and uninstalling the editor does not
help, because the cookies stay in the profile. Run:

```
FreebuffThemeInjector.exe --reset-theme --restart
```

That closes Freebuff, deletes only the theme cookies (everything else in the profile is
left alone), and starts it again. Version 1.3.3 and later can never cause this: pictures
are no longer stored in cookies, and the stored theme has a hard size ceiling.

**Something looks broken and I want it gone.**
Run `FreebuffThemeInjector.exe --uninstall`. This always works, even if the page itself
will not load. Uninstall removes the injected block rather than restoring the old file
blindly: if Freebuff updated itself after the install, the newer file is kept and only the
Theme Studio part is taken out.

**Parts of the app keep the light colours - the settings page, a dialog, or the panel itself.**
Freebuff ships a light and a dark palette and switches between them with its own appearance
setting. A theme now carries its own appearance with it: applying a dark theme also puts the
app's palette switch into dark, and every token the theme sets is re-declared on the elements
Freebuff itself declares it on, so nothing is left wearing the other palette. If you still see
this with a theme made by an old version, update the extension - it was a bug in the editor,
not in your theme.

**Something looks wrong but I want to keep my theme.**
Run `FreebuffThemeInjector.exe --repair`. It rewrites the extension files from this build
and leaves your saved colours, layout and gradient settings untouched. Use
`--reset-theme` only when you actually want the stored theme deleted.

**The installer cannot find Freebuff.**
Point it at the folder yourself with `--path`, for example:

```
FreebuffThemeInjector.exe --path "C:\Users\You\AppData\Local\Programs\@codebufffreebuff-desktop"
```

**Freebuff was open while I installed.**
That is fine. Press `Ctrl+R` in Freebuff. You can also add `--restart` when installing to
have it reopened for you.

---

## All command options

| Option | What it does |
| --- | --- |
| *(no options)* | Install the theme editor |
| `--status` | Check whether it is installed, and how big the stored theme is |
| `--uninstall` | Remove it, restore the original file and clear the stored theme |
| `--reset-theme` | Delete only the stored theme cookies - the fix for a blank grey window |
| `--repair` | Rewrite the current files and keep your stored theme |
| `--theme FILE` | Use a theme file as the starting theme for new sessions |
| `--path DIR` | Target a specific Freebuff folder |
| `--restart` | Close Freebuff if it is running, then start it again |
| `--open` | Open the interface folder in File Explorer |
| `--remove-watch` | Stop the background guard and remove it from logon |
| `--watch` | What the guard runs as; you do not start this by hand |
| `--quiet` | Print less |

Examples:

```
FreebuffThemeInjector.exe --restart
FreebuffThemeInjector.exe --theme my-theme.json
FreebuffThemeInjector.exe --status
FreebuffThemeInjector.exe --repair --restart
FreebuffThemeInjector.exe --uninstall
```

---

## For developers

### How it works

Freebuff Desktop is an Electron app. Its window loads a web page from a small local
web server that runs on your machine, and that server reads its interface files straight
from disk every time the page loads.

That gives a clean place to hook in. The installer changes exactly these inside the
Freebuff folder:

```
resources/orchestrator/ui/index.html                          adds two script tags
resources/orchestrator/ui/assets/freebuff-theme-studio.js     the theme editor
resources/orchestrator/ui/assets/freebuff-theme-community.js  the community theme list
```

It does not modify `app.asar` and it does not patch any binary. A copy of the original
`index.html` is kept next to it as `index.html.freebuff-theme-original.bak`, which is what
`--uninstall` restores.

### How the theming works

Freebuff's entire look is built from 212 CSS custom properties, names like `--bg`,
`--surface`, `--brand-2` and `--syntax-keyword`. The editor sets those as inline styles
on the page's root element, which overrides every stylesheet rule the app ships. Because
many of the app's colours are defined in terms of others, changing a few of them updates
a great deal of the interface automatically.

Inline styles on `<html>` reach everything that reads a token from `:root`, but not the
handful of tokens the app redeclares further down its own tree - `--workspace-corner`,
`--shell-inset`, `--tabbar-height` and the settings page radii among them. A declaration
on the element that uses a token beats one inherited from an ancestor, so those could not
be themed from the root at all. The editor therefore also writes a `<style>` element into
`<head>`, with those tokens set `!important` on a selector list covering every element the
app does this to. The same sheet carries the things that are properties rather than custom
properties: the window buttons, the logo and the background picture.

The editor paints itself with the live theme background, and a translucent background
colour would otherwise make the editor itself see-through, with the app showing through
the controls. Every box it owns therefore draws its theme colour as a layer over an opaque
floor - the theme's own background at full strength, worked out in the engine. Compositing
a translucent colour over itself gives the solid colour back, so this changes nothing at
all until somebody makes a colour translucent, and the panel stays readable when they do.

The editor page itself is rendered in a shadow DOM, so Freebuff's styles cannot affect it,
but it reads its own colours from the app's properties. The result is that the editor is
themed by the theme you apply.

### The sidebar icon

Freebuff renders its sidebar icons as `.shell-nav-button` elements inside
`.shell-navigation-top`. The editor adds one more button there and gives it the same class,
so Freebuff styles it and handles the active highlight. A `MutationObserver`, plus a
repeated check every 1.5 seconds, puts it back if Freebuff ever rebuilds that part of the
interface.

The page is a full-window page, not a panel. Freebuff's own views live inside
`.workspace-frame`, which the shell insets with `--shell-rail-width` on the left and
`--shell-inset` on the right and bottom, below a `--tabbar-height` tab row. Those three
properties are declared on `.desktop-shell`, not on `:root`, and the editor's shadow host
is a child of `<body>`, so it cannot inherit them - reading them with `var()` silently
fell back to the wrong numbers and the page never lined up.

The editor therefore measures `.workspace-frame` itself and writes the result as inline
styles, then keeps it in step with a `ResizeObserver` and a window resize listener. That
survives compact mode, a collapsed sidebar, and Freebuff's separate thread windows.

### How the update check works

Freebuff's page policy allows remote stylesheets but blocks `fetch()` to anything outside
`127.0.0.1`, so the page cannot call the GitHub API. Instead it loads
[update.css](update.css) and reads one value out of it with `getComputedStyle`, which
works for a cross-origin stylesheet without CORS.

The file declares nothing but a version:

```css
html[data-fbts-update-probe] {
  --fbts-remote-version: "1.1.0";
}
```

The editor asks for it through jsDelivr, which is a read-only mirror of this repository's
`main` branch. `raw.githubusercontent.com` cannot be used for this: it serves CSS as
`text/plain` with `X-Content-Type-Options: nosniff`, and a browser refuses to apply a
cross-origin stylesheet that is not `text/css`. jsDelivr serves the same file as
`text/css`, so no CORS and no extra hosting are needed.

The same file is requested from all three of jsDelivr's edge networks - `cdn`, `fastly`
and `gcore` - **and** from `cdn.statically.io` at the same time, and the **newest** answer
wins. That matters: jsDelivr's networks have been seen serving three different versions of
the feed at once, and asking them one after another meant the first stale edge decided the
answer - a release nobody was ever told about, which is how "auto update does not work"
starts. One fresh host is now enough, and no host can hang the check: each probe gives up
after eight seconds.

jsDelivr sends `max-age=604800` for browser caches, so the request carries a per-hour query
string. jsDelivr ignores query strings for its own cache, so this only stops a browser from
holding a stale copy for a week; a check at most once an hour therefore always gets a
current answer, within an hour of any change.

If every mirror fails - offline, CDN trouble, or a future Freebuff policy that blocks
stylesheets - the version line in the header reads `offline` rather than failing silently,
and clicking it tries again.

**Releasing a new version** means three edits, a push, and one cache purge:

1. `VERSION` in `injector/assets/theme-engine.js`.
2. `version` in `injector/main.go`.
3. `--fbts-remote-version` in `update.css`.

Then build, push to `main`, attach the new `.exe` to a `vX.Y.Z` release on GitHub, and tell
jsDelivr to drop its copy of the feed:

```bash
curl https://purge.jsdelivr.net/gh/RichardFlp/freebuff-ui@main/update.css
```

Without the purge the CDN keeps serving the old feed for up to twelve hours (`s-maxage`),
which is the one thing that should never be stale. Installed copies then notice the new
version on their next check, at most an hour later.

### Where your theme is stored

In cookies. Freebuff chooses a new port every time it starts, and browser storage is tied
to the combination of address and port, so ordinary storage would be lost on every restart.
Cookies are tied to the address only, so they survive.

Cookies have a cost that decides how much can be stored. They are sent with **every**
request, and the server that serves Freebuff's window answers HTTP 431 - and the window
stays blank - once the request headers pass 16 KB. Measured against the Bun that ships with
Freebuff, a 16,000-byte cookie header is fine and a 24,000-byte one is refused. The stored
theme therefore has a hard ceiling of two chunks, 6.8 KB, which is comfortably more than
the largest theme the panel can build (overriding all 101 colours it lists comes to
6.4 KB) while leaving the app's own cookies plenty of room.

The payload is base64url-encoded before it is split, which looks wasteful (it adds a
third) and is not: the naive approach was to chunk the JSON itself, and because a browser
escapes `"`, `{`, `}` and `:` when it stores a cookie value, a 3200-character chunk landed
around 6000 bytes, over the 4096-byte cookie limit, and was dropped without a word.

Each save goes to a fresh generation and the counter cookie - `fbts_theme_n`, which reads
`<generation>:<count>,` for example `4:2` - is switched to it in a single write. The
previous save stays complete and readable until the new one is, so closing or killing
Freebuff in the middle of a save can no longer cost the theme that was already there.

Nothing is written until something has actually changed. That matters because of the
worst bug this tool has had: if a load came up empty, the engine used to boot on the
default theme and then save that default at the first click, destroying the theme still
sitting in the cookies. An untouched default is never saved, and if a stored theme cannot
be read the panel says so.

Writes are throttled: the first edit after a pause is written at once, and a long drag is
written at least every 1.5 seconds - an older version reset its timer on every change, so a
continuous drag saved nothing at all until the mouse stopped. The page also flushes on
being hidden or closed.

Pictures are the one thing that does not go in a cookie, for the 16 KB reason above; they
live in the theme's session state and in `.fbtheme` files. Versions up to 1.3.2 did store
one in its own cookie series (`fbts_img_0`, …, `fbts_img_n`), which is what could put a
quarter of a megabyte into every request; those cookies are read once and then deleted.

### Building from source

You need Go 1.21 or newer. There are no other dependencies.

```bash
cd injector
go build -trimpath -ldflags "-s -w" -o ../dist/FreebuffThemeInjector.exe .
```

The editor script in `injector/assets/theme-engine.js` is compiled into the program with
`go:embed`, so the resulting `.exe` is completely self-contained.

### Project layout

```
freebuff-theme-studio/
  injector/
    main.go                    finds Freebuff, installs, checks, uninstalls
    go.mod
    assets/theme-engine.js     the editor page (the real source of truth)
    assets/community-themes.js the bundled community themes (data only)
  dist/
    FreebuffThemeInjector.exe  the built program
  update.css                   the version the installed editor reads from main
  sandbox/
    demo.html                  a mock Freebuff shell for previewing the editor
    fake-install/              a fake Freebuff folder for testing the installer safely
```

### Trying it without touching Freebuff

```bash
# from this folder
python -m http.server 8199 --bind 127.0.0.1
# then open http://127.0.0.1:8199/sandbox/demo.html
```

### Testing the installer safely

```bash
./dist/FreebuffThemeInjector.exe --path sandbox/fake-install
./dist/FreebuffThemeInjector.exe --path sandbox/fake-install --status
./dist/FreebuffThemeInjector.exe --path sandbox/fake-install --uninstall
```

---

## Surviving a Freebuff update

Freebuff's updater replaces `resources/orchestrator` as a whole, including the interface
file the panel is injected into. Before the guard existed, every Freebuff update quietly
removed Theme Studio until the installer was run again.

So an install also leaves a small guard behind:

- a copy of this exe in `%LOCALAPPDATA%\FreebuffThemeStudio`,
- a `Run` value in **HKCU** (your account only - no admin, nothing machine-wide) that
  starts it at logon,
- `guard.json` in that folder, which records that the panel belongs to this machine.

Every fifteen seconds the guard looks at the interface file. If the injection or the
engine has been swept away by an update, it writes them back - using `guard.json`, because
the updater deletes the install's own manifest along with everything else in that folder.
It waits for the file to stop changing first, so it never writes into an update that is
still being unpacked, and it only ever touches the install it was set up for. It prints
nothing; what it did is appended to `watcher.log` next to it.

`FreebuffThemeInjector.exe --uninstall` and `--remove-watch` both take the guard away
again - entry, process and files. It is a normal background process: no service, no
driver, no scheduled task, and it does nothing except watch one file.

---

## Things to know

- A Freebuff update used to remove the palette icon, because it replaces the interface
  file. The background guard now puts it back by itself; running the installer again does
  the same thing and is always safe.
- The editor also appears in Freebuff's separate thread windows, which is intended.
- This is an unofficial tool, not made by Freebuff. The README says so at the top, the
  Theme Studio header says so, and the installer prints it when it runs.
- The update check is the only thing here that talks to the internet, and it only fetches
  a 900-byte file from jsDelivr, at most once an hour. It sends nothing about you or your
  Freebuff install. Skipping a version is remembered in a cookie, never online.
- A background picture and a custom logo are stored inline in the theme, so a `.fbtheme`
  file containing one is self-contained but bigger. They last for the session rather than
  being remembered between launches; `--theme FILE` bakes one in permanently.
- Community themes are bundled with each release rather than downloaded, so that tab needs
  no network and cannot break if a CDN does.
