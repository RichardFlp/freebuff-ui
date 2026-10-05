// Freebuff Theme Studio - injector
//
// Installs a theme customisation panel into a local Freebuff Desktop install.
//
// How it works: Freebuff Desktop's renderer is served by a Bun orchestrator
// bound to 127.0.0.1. That server (`serveSpa`) serves `resources/orchestrator/ui`
// straight off disk on every request, and computes its Content-Security-Policy
// from the document it just read - so an extra same-origin <script> is allowed
// and takes effect on the next page load.
//
// We therefore only ever touch these files inside the install:
//
//	resources/orchestrator/ui/index.html                        (+ injected <script> tags)
//	resources/orchestrator/ui/assets/freebuff-theme-studio.js   (the engine)
//	resources/orchestrator/ui/assets/freebuff-theme-community.js (community theme list)
//
// Nothing is patched in app.asar and no binary is modified.
package main

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed assets/theme-engine.js
var engineJS []byte

//go:embed assets/community-themes.js
var communityJS []byte

const (
	version       = "1.4.1"
	markerStart   = "<!-- freebuff-theme-studio:start -->"
	markerEnd     = "<!-- freebuff-theme-studio:end -->"
	engineName    = "freebuff-theme-studio.js"
	communityName = "freebuff-theme-community.js"
	defaultName   = "freebuff-theme-default.js"
	// Past this the request header block approaches the 16 KB the app's own
	// server accepts, and every request starts failing.
	cookieDangerBytes = 12000
	backupSuffix      = ".freebuff-theme-original.bak"
	manifestName      = ".freebuff-theme-studio.json"
	// uninstallCookie is the panel's request to be removed. It carries the
	// `fbts` prefix on purpose: profileCookieDBs only returns jars that hold
	// something of ours, and the guard's clear pass deletes `fbts%` - so the
	// request is both found and wiped by the same machinery as the theme.
	uninstallCookie = "fbts_uninstall"
)

var (
	colBold  = ""
	colDim   = ""
	colGreen = ""
	colRed   = ""
	colCyan  = ""
	colReset = ""
)

// ---------------------------------------------------------------- console ---

func enableVT() bool {
	if runtime.GOOS != "windows" {
		return true
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getStdHandle := kernel32.NewProc("GetStdHandle")
	setConsoleMode := kernel32.NewProc("SetConsoleMode")
	const stdOutputHandle = ^uintptr(10) // -11
	h, _, _ := getStdHandle.Call(stdOutputHandle)
	if h == 0 || h == uintptr(^uintptr(0)) {
		return false
	}
	var mode uint32
	// GetConsoleMode is exported too; if it fails the handle is not a console.
	getConsoleMode := kernel32.NewProc("GetConsoleMode")
	if r, _, _ := getConsoleMode.Call(h, uintptr(unsafe.Pointer(&mode))); r == 0 {
		return false
	}
	const enableVirtualTerminalProcessing = 0x0004
	if r, _, _ := setConsoleMode.Call(h, uintptr(mode|enableVirtualTerminalProcessing)); r == 0 {
		return false
	}
	return true
}

func initColors() {
	if enableVT() {
		colBold = "\x1b[1m"
		colDim = "\x1b[2m"
		colGreen = "\x1b[32m"
		colRed = "\x1b[31m"
		colCyan = "\x1b[36m"
		colReset = "\x1b[0m"
	}
}

func banner() {
	fmt.Printf("%s\n", colBold+"Freebuff Theme Studio"+colReset+" "+colDim+"v"+version+colReset)
	fmt.Printf("%s\n", colDim+"Custom colour themes for Freebuff Desktop."+colReset)
	fmt.Printf("%s\n\n", colDim+"Unofficial community extension - not made by Freebuff."+colReset)
}

func ok(msg string, a ...any) {
	fmt.Printf("  %s[ ok ]%s %s\n", colGreen, colReset, fmt.Sprintf(msg, a...))
}
func info(msg string, a ...any) {
	fmt.Printf("  %s[ .. ]%s %s\n", colCyan, colReset, fmt.Sprintf(msg, a...))
}
func warn(msg string, a ...any) {
	fmt.Printf("  %s[ !! ]%s %s\n", colRed, colReset, fmt.Sprintf(msg, a...))
}
func step(msg string, a ...any) { fmt.Printf("\n%s%s%s\n", colBold, fmt.Sprintf(msg, a...), colReset) }

// --------------------------------------------------------------- locating ---

func runningExecutable() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	// Prefer the live process: it is the install the user actually runs.
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		`(Get-Process Freebuff -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path`)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return ""
	}
	return p
}

func isInstallDir(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "resources", "orchestrator", "ui", "index.html"))
	return err == nil
}

func candidateDirs() []string {
	var out []string

	if exe := runningExecutable(); exe != "" {
		out = append(out, filepath.Dir(exe))
	}

	local := os.Getenv("LOCALAPPDATA")
	roaming := os.Getenv("APPDATA")
	progFiles := os.Getenv("ProgramFiles")
	progFilesX86 := os.Getenv("ProgramFiles(x86)")

	names := []string{
		"@codebufffreebuff-desktop",
		"freebuff-desktop",
		"Freebuff",
		"Freebuff Desktop",
		"freebuff",
	}
	roots := []string{local, roaming, progFiles, progFilesX86}
	for _, root := range roots {
		if root == "" {
			continue
		}
		for _, n := range names {
			out = append(out, filepath.Join(root, "Programs", n))
			out = append(out, filepath.Join(root, n))
		}
	}

	// Running from the install tree itself.
	if wd, err := os.Getwd(); err == nil {
		out = append(out, wd)
	}
	return out
}

func findInstallDir(override string) (string, error) {
	if override != "" {
		abs, err := filepath.Abs(override)
		if err != nil {
			return "", err
		}
		if !isInstallDir(abs) {
			return "", fmt.Errorf("%s does not look like a Freebuff install (no resources/orchestrator/ui/index.html)", abs)
		}
		return abs, nil
	}
	seen := map[string]bool{}
	for _, c := range candidateDirs() {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		if isInstallDir(c) {
			return c, nil
		}
	}
	return "", errors.New("could not find a Freebuff Desktop install; pass --path <install dir>")
}

// ---------------------------------------------------------------- manifest ---

type manifest struct {
	Version       string `json:"version"`
	InstalledAt   string `json:"installedAt"`
	OriginalSHA   string `json:"originalIndexSha256"`
	HadBackup     bool   `json:"hadBackup"`
	BakedThemeSet bool   `json:"bakedThemeSet"`
}

func manifestPath(ui string) string { return filepath.Join(ui, manifestName) }
func indexPath(ui string) string    { return filepath.Join(ui, "index.html") }
func assetsDir(ui string) string    { return filepath.Join(ui, "assets") }
func backupPath(ui string) string   { return indexPath(ui) + backupSuffix }

func readManifest(ui string) *manifest {
	b, err := os.ReadFile(manifestPath(ui))
	if err != nil {
		return nil
	}
	var m manifest
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return &m
}

func sha256Hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// atomicWriteFile keeps a crash or failed write from leaving a truncated file.
func atomicWriteFile(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".fbts-*.tmp")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err := f.Chmod(mode); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		return os.Rename(temp, path)
	}
	src, err := syscall.UTF16PtrFromString(temp)
	if err != nil {
		return err
	}
	dst, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	moveFileEx := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")
	const moveFileReplaceExisting = 0x1
	const moveFileWriteThrough = 0x8
	result, _, callErr := moveFileEx.Call(uintptr(unsafe.Pointer(src)), uintptr(unsafe.Pointer(dst)), moveFileReplaceExisting|moveFileWriteThrough)
	if result == 0 {
		return fmt.Errorf("atomically replacing %s: %w", path, callErr)
	}
	return nil
}

// markerBounds rejects partial, duplicated and out-of-order injection markers.
func markerBounds(html string) (int, int, bool, error) {
	starts := strings.Count(html, markerStart)
	ends := strings.Count(html, markerEnd)
	if starts == 0 && ends == 0 {
		return -1, -1, false, nil
	}
	if starts != 1 || ends != 1 {
		return -1, -1, false, errors.New("index.html has duplicated or incomplete Theme Studio markers")
	}
	start := strings.Index(html, markerStart)
	end := strings.Index(html, markerEnd)
	if end < start+len(markerStart) {
		return -1, -1, false, errors.New("index.html has out-of-order Theme Studio markers")
	}
	return start, end + len(markerEnd), true, nil
}

func stripInjected(html string) (string, bool, error) {
	start, end, found, err := markerBounds(html)
	if err != nil || !found {
		return html, found, err
	}
	suffix := html[end:]
	if strings.HasPrefix(suffix, "\r\n") {
		suffix = suffix[2:]
	} else if strings.HasPrefix(suffix, "\n") {
		suffix = suffix[1:]
	}
	return html[:start] + suffix, true, nil
}

// ------------------------------------------------------------------ inject ---

func scriptBlock(ui string) string {
	nl := "\n"
	raw, err := os.ReadFile(indexPath(ui))
	if err == nil && strings.Contains(string(raw), "\r\n") {
		nl = "\r\n"
	}
	var b strings.Builder
	b.WriteString(markerStart + nl)
	if _, err := os.Stat(filepath.Join(assetsDir(ui), defaultName)); err == nil {
		b.WriteString(`  <script src="./assets/` + defaultName + `"></script>` + nl)
	}
	// The community list is a plain data file and must be loaded first: the
	// engine reads it while it builds the Community tab.
	b.WriteString(`  <script src="./assets/` + communityName + `"></script>` + nl)
	b.WriteString(`  <script src="./assets/` + engineName + `" data-freebuff-theme-studio="` + version + `"></script>` + nl)
	b.WriteString(markerEnd)
	return b.String()
}

// inject is idempotent: re-running replaces the marker block rather than
// stacking a second one.
func inject(ui string, quiet bool) error {
	idx := indexPath(ui)
	original, err := os.ReadFile(idx)
	if err != nil {
		return fmt.Errorf("reading index.html: %w", err)
	}
	html := string(original)

	if !strings.Contains(strings.ToLower(html), "freebuff") && !strings.Contains(html, "startup-recovery") {
		return errors.New("index.html does not look like the Freebuff UI; refusing to modify it")
	}

	start, end, alreadyInjected, err := markerBounds(html)
	if err != nil {
		return err
	}

	// Keep the pristine checksum stable across repeat installs. On a first
	// install the backup is created only after all marker checks have passed.
	pristine := original
	if b, readErr := os.ReadFile(backupPath(ui)); readErr == nil {
		pristine = b
	} else if alreadyInjected {
		stripped, _, err := stripInjected(html)
		if err != nil {
			return err
		}
		pristine = []byte(stripped)
	}
	if !alreadyInjected {
		if _, statErr := os.Stat(backupPath(ui)); os.IsNotExist(statErr) {
			if err := atomicWriteFile(backupPath(ui), original, 0o644); err != nil {
				return fmt.Errorf("writing backup: %w", err)
			}
			if !quiet {
				ok("Backed up original index.html")
			}
		} else if statErr != nil {
			return fmt.Errorf("checking backup: %w", statErr)
		}
	}

	block := scriptBlock(ui)
	var updated string
	if alreadyInjected {
		updated = html[:start] + block + html[end:]
	} else if k := strings.LastIndex(html, "</body>"); k != -1 {
		updated = html[:k] + block + "\n" + html[k:]
	} else {
		updated = html + "\n" + block + "\n"
	}

	if err := os.MkdirAll(assetsDir(ui), 0o755); err != nil {
		return fmt.Errorf("creating assets dir: %w", err)
	}
	if err := atomicWriteFile(filepath.Join(assetsDir(ui), engineName), engineJS, 0o644); err != nil {
		return fmt.Errorf("writing engine: %w", err)
	}
	if err := atomicWriteFile(filepath.Join(assetsDir(ui), communityName), communityJS, 0o644); err != nil {
		return fmt.Errorf("writing community themes: %w", err)
	}
	// Write the recovery metadata before making the new index visible. A failed
	// index replacement can then be retried or cleanly uninstalled.
	if err := writeManifest(ui, pristine); err != nil {
		return err
	}
	if err := atomicWriteFile(idx, []byte(updated), 0o644); err != nil {
		return fmt.Errorf("writing index.html: %w", err)
	}
	return nil
}

func writeManifest(ui string, original []byte) error {
	hadBackup := true
	if _, err := os.Stat(backupPath(ui)); err != nil {
		hadBackup = false
	}
	baked := false
	if _, err := os.Stat(filepath.Join(assetsDir(ui), defaultName)); err == nil {
		baked = true
	}
	// InstalledAt is when Theme Studio first went into this install, and a
	// re-inject deliberately does not refresh it: the panel's Delete button is
	// only honoured while its request is newer than the injection it belongs to
	// (see uninstallRequestPending), so a Freebuff update that puts the panel
	// back must not quietly cancel a request the user just made.
	installedAt := time.Now().UTC().Format(time.RFC3339)
	if prev := readManifest(ui); prev != nil && prev.InstalledAt != "" {
		installedAt = prev.InstalledAt
	}
	m := manifest{
		Version:       version,
		InstalledAt:   installedAt,
		OriginalSHA:   sha256Hex(original),
		HadBackup:     hadBackup,
		BakedThemeSet: baked,
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return atomicWriteFile(manifestPath(ui), b, 0o644)
}

func bakeTheme(ui, themeFile string) error {
	b, err := os.ReadFile(themeFile)
	if err != nil {
		return err
	}
	if len(b) == 0 || len(b) > 12*1024*1024 {
		return errors.New("theme file must be between 1 byte and 12 MB")
	}
	var probe map[string]any
	if err := json.Unmarshal(b, &probe); err != nil {
		return fmt.Errorf("theme file must contain a JSON object: %w", err)
	}
	if probe == nil {
		return errors.New("theme file must contain a JSON object")
	}
	if inner, wrapped := probe["theme"]; wrapped {
		if _, ok := inner.(map[string]any); !ok {
			return errors.New("theme envelope must contain a theme object")
		}
	}
	// A .fbtheme document wraps the theme; bake the theme itself.
	if inner, ok := probe["theme"].(map[string]any); ok {
		_, hasColors := probe["colors"]
		_, hasLayout := probe["layout"]
		if !hasColors && !hasLayout {
			if wrapped, err := json.Marshal(inner); err == nil {
				b = wrapped
			}
		}
	}
	body := "/* baked by FreebuffThemeInjector --theme */\nwindow.__FREEBUFF_THEME_DEFAULT__ = " + string(b) + ";\n"
	return atomicWriteFile(filepath.Join(assetsDir(ui), defaultName), []byte(body), 0o644)
}

// ------------------------------------------------------------ remove it all ---

// uninstallRequestPending reports whether the panel's Delete button has asked to
// be removed, and returns the timestamp of that request.
//
// The panel cannot delete anything itself: it is a sandboxed renderer with no
// filesystem access, which is why the Settings tab used to end by telling the
// user to go and run --uninstall by hand. Instead it clears what it owns and
// leaves this cookie, and the guard - an ordinary process - does the deleting.
//
// The value is epoch milliseconds, which is what the panel writes: digits need
// no cookie escaping, so the value read here is the value written there.
//
// A request is honoured only while it is newer than the injection it belongs to.
// The cookie is normally deleted by the removal itself, but that deletion is the
// one step that can fail (it needs Freebuff closed and Bun present), and without
// this check a request that outlived its install would undo the next install.
func uninstallRequestPending(install string) (string, bool) {
	m := readManifest(filepath.Join(install, "resources", "orchestrator", "ui"))
	if m == nil {
		// No manifest means no injection the guard owns; the next tick writes a
		// fresh one, and any request is older than that by definition.
		return "", false
	}
	bun := bunBinary(install)
	if bun == "" {
		return "", false
	}
	for _, db := range profileCookieDBs() {
		// Cheap first: do not launch Bun for a jar whose bytes cannot hold it.
		if b, err := os.ReadFile(db); err != nil || !bytes.Contains(b, []byte(uninstallCookie)) {
			continue
		}
		rep, err := runCookieScript(bun, db, "report")
		if err != nil || strings.TrimSpace(rep.Request) == "" {
			continue
		}
		raw := strings.TrimSpace(rep.Request)
		ms, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			// A damaged timestamp must not be able to trigger a removal, for the
			// same reason: it would fire again on every future install.
			return "", false
		}
		req := time.UnixMilli(ms)
		if installed, err := time.Parse(time.RFC3339, m.InstalledAt); err == nil && !req.After(installed) {
			return "", false
		}
		return raw, true
	}
	return "", false
}

// scheduleSelfRemoval deletes this executable's folder a moment after this
// process exits. Windows will not delete a running image but will happily rename
// one, which is why removeWatch() leaves at most one file behind - the guard's
// own .exe - and why the leftover has to be cleaned up from outside. Nothing
// happens unless this process is the installed guard: an installer the user
// downloaded is their file, not ours to delete.
// scheduleDirRemoval arranges for the guard's folder to be taken away from
// outside, a moment from now. A process cannot delete its own image, and
// os.RemoveAll gives up at the first locked file, so anything still in there
// has to be waited out by something else. ping is the sleep: unlike `timeout`,
// it needs no console and no redirect.
func scheduleDirRemoval() {
	if runtime.GOOS != "windows" {
		return
	}
	dir := watchDir()
	if dir == "" {
		return
	}
	script := fmt.Sprintf(`ping -n 4 127.0.0.1 >nul & rmdir /s /q "%s" >nul 2>&1`, dir)
	cmd := exec.Command("cmd.exe", "/c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedFlag}
	if err := cmd.Start(); err != nil {
		return
	}
	_ = cmd.Process.Release()
}

// scheduleSelfRemoval is scheduleDirRemoval for the case where this process IS
// the installed guard. An installer the user downloaded is their file, and is
// left exactly where it is.
func scheduleSelfRemoval() {
	if selfImage == "" {
		return
	}
	dir := watchDir()
	if dir == "" || !strings.EqualFold(filepath.Clean(filepath.Dir(selfImage)), filepath.Clean(dir)) {
		return
	}
	scheduleDirRemoval()
}

// removeEverything takes Theme Studio back off the machine: the stored theme
// first (which needs Freebuff closed, or Chromium writes the jar back), then the
// injected files and the backup, then the guard itself. --uninstall runs it, and
// it is what the guard runs when the Delete button in the Settings tab asks.
// Returns false when any step failed, so --uninstall can still exit non-zero.
func removeEverything(install, ui string, quiet bool) bool {
	// Scheduled before anything else touches this image. removeWatch() renames a
	// running guard rather than deleting it (Windows allows a rename where it
	// refuses a delete), and once that has happened there is no way left to ask
	// where we are: os.Executable() has nothing to report.
	scheduleSelfRemoval()
	ok := true
	if _, cleared := clearThemeCookies(install, quiet); !cleared {
		ok = false
		if !quiet {
			warn("The stored theme could not be cleared - run --reset-theme after Freebuff is closed")
		}
	}
	if err := uninstall(ui, quiet); err != nil {
		ok = false
		if !quiet {
			warn("%v", err)
		}
	}
	// Nothing may re-inject after a removal, so the guard goes last and takes
	// its logon entry with it.
	removeWatch()
	return ok
}

// --------------------------------------------------------------- uninstall ---

func uninstall(ui string, quiet bool) error {
	idx := indexPath(ui)
	html, err := os.ReadFile(idx)
	if err != nil {
		return err
	}
	stripped, found, err := stripInjected(string(html))
	if err != nil {
		return err
	}
	backup, backupErr := os.ReadFile(backupPath(ui))
	m := readManifest(ui)
	restored := false
	if backupErr == nil && m != nil && m.OriginalSHA == sha256Hex(backup) {
		matchesBackup := stripped == string(backup) || stripped == string(backup)+"\n" || stripped == string(backup)+"\r\n"
		if matchesBackup {
			if err := atomicWriteFile(idx, backup, 0o644); err != nil {
				return err
			}
			if err := os.Remove(backupPath(ui)); err != nil && !os.IsNotExist(err) {
				return err
			}
			restored = true
		} else if found {
			// The page changed outside our block (an app update, or a user edit).
			// Strip the injection but do NOT restore the stale backup over it.
			if err := atomicWriteFile(idx, []byte(stripped), 0o644); err != nil {
				return err
			}
			if !quiet {
				warn("Removed Theme Studio without restoring the older backup; index.html contains newer changes")
			}
		}
	} else if found {
		if err := atomicWriteFile(idx, []byte(stripped), 0o644); err != nil {
			return err
		}
	}
	if !found && !quiet {
		info("No Theme Studio marker was present in index.html")
	}
	for _, name := range []string{engineName, communityName, defaultName} {
		if err := os.Remove(filepath.Join(assetsDir(ui), name)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing %s: %w", name, err)
		}
	}
	if err := os.Remove(manifestPath(ui)); err != nil && !os.IsNotExist(err) {
		return err
	}
	if !quiet {
		ok("Removed injected scripts, engine and manifest")
		if restored {
			ok("Restored original index.html")
		}
	}
	return nil
}

func status(ui, install string) {
	m := readManifest(ui)
	html, _ := os.ReadFile(indexPath(ui))
	injected := strings.Contains(string(html), markerStart)
	engine := filepath.Join(assetsDir(ui), engineName)
	_, engineErr := os.Stat(engine)

	fmt.Printf("  install   %s\n", ui)
	if injected && engineErr == nil {
		ok("Theme Studio is installed")
	} else {
		warn("Theme Studio is NOT installed")
	}
	if m != nil {
		fmt.Printf("  version   %s\n", m.Version)
		fmt.Printf("  installed %s\n", m.InstalledAt)
	}
	if _, err := os.Stat(backupPath(ui)); err == nil {
		fmt.Printf("  backup    %s\n", backupPath(ui))
	}
	if _, err := os.Stat(filepath.Join(assetsDir(ui), defaultName)); err == nil {
		fmt.Printf("  baked theme file present\n")
	}
	if guardInstalled() {
		if runEntryPresent() {
			ok("Background guard is installed (restarts Freebuff's panel after an update)")
		} else {
			warn("Background guard is installed but not registered to start at logon")
		}
	} else {
		fmt.Printf("  guard     not installed (a Freebuff update will remove the panel)\n")
	}
	checkThemeCookies(install)
}

// ---------------------------------------------------------- theme cookies ---

/*
 * The theme lives in cookies, because they are the only store that survives a
 * launch: Freebuff serves its UI from a fresh loopback port every time, so
 * localStorage (which is per-origin, and therefore per-port) does not carry
 * over.
 *
 * Cookies have a cost the theme engine has to respect: they are sent with
 * every request, and the Bun server that serves the UI answers HTTP 431 - and
 * the window stays blank and grey - once the request header block passes
 * 16 KB. An early version stored pictures in cookies as well, which could put
 * a quarter of a megabyte into that header, and then no uninstall helped
 * because the cookies were still in the profile.
 *
 * So this is the way out. Chromium keeps its cookie jar in a small SQLite file
 * inside the Freebuff profile; the install ships its own Bun, and Bun reads
 * SQLite natively, so the installer can delete exactly the theme cookies and
 * leave everything else - including Freebuff's own cookies - alone.
 */

const cookieDBScript = `(async () => {
  const { Database } = await import('bun:sqlite')
  const db = new Database(process.env.FREEBUFF_COOKIE_DB)
  const sql = "select count(*) as n, coalesce(sum(length(value)), 0) as b from cookies where name like 'fbts%'"
  const before = db.query(sql).get()
  const out = { cookies: before.n, bytes: before.b, action: process.env.FBTS_COOKIE_ACTION }
  const req = db.query("select value from cookies where name = 'fbts_uninstall'").get()
  out.request = req ? req.value : ''
  if (process.env.FBTS_COOKIE_ACTION === 'clear') {
    db.run("delete from cookies where name like 'fbts%'")
    out.remaining = db.query(sql).get().n
  }
  console.log(JSON.stringify(out))
})()`

type cookieReport struct {
	Cookies   int    `json:"cookies"`
	Bytes     int    `json:"bytes"`
	Action    string `json:"action"`
	Remaining int    `json:"remaining"`
	// Request is the panel's removal request, empty when there is none.
	Request string `json:"request"`
}

/*
 * Every cookie jar that can hold our cookies.
 *
 * Chromium keeps the default profile's jar at <userData>/Network/Cookies, but
 * an Electron build can also run additional profiles under
 * <userData>/Partitions/<name>/Network/Cookies. Missing those was how a reset
 * could report success while a second profile still carried an oversized theme
 * and kept the app on a blank window. Only jars that actually contain our
 * prefix are returned, so no other application's cookies are ever touched.
 */
func profileCookieDBs() []string {
	var names []string
	seenName := map[string]bool{}
	for _, root := range []string{os.Getenv("APPDATA"), os.Getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.Contains(strings.ToLower(name), "freebuff") {
				continue
			}
			if seenName[name] {
				continue
			}
			seenName[name] = true
			names = append(names, name)
		}
	}

	var candidates []string
	for _, root := range []string{os.Getenv("APPDATA"), os.Getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		for _, name := range names {
			base := filepath.Join(root, name)
			candidates = append(candidates, filepath.Join(base, "Network", "Cookies"))
			parts, err := os.ReadDir(filepath.Join(base, "Partitions"))
			if err != nil {
				continue
			}
			for _, p := range parts {
				if !p.IsDir() {
					continue
				}
				candidates = append(candidates, filepath.Join(base, "Partitions", p.Name(), "Network", "Cookies"))
			}
		}
	}

	var out []string
	seen := map[string]bool{}
	for _, p := range candidates {
		if seen[p] {
			continue
		}
		seen[p] = true
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		// Only a jar that really holds our cookies in it.
		if bytes.Contains(b, []byte("fbts")) {
			out = append(out, p)
		}
	}
	return out
}

func bunBinary(install string) string {
	for _, p := range []string{
		filepath.Join(install, "resources", "bun", "bun.exe"),
		filepath.Join(install, "resources", "bun", "bun-baseline.exe"),
		filepath.Join(install, "resources", "orchestrator", "bun.exe"),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	return ""
}

// runCookieScript opens a profile cookie jar and either reports or clears the
// theme cookies in it.
func runCookieScript(bun, db, action string) (*cookieReport, error) {
	cmd := exec.Command(bun, "-e", cookieDBScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Env = append(os.Environ(), "FREEBUFF_COOKIE_DB="+db, "FBTS_COOKIE_ACTION="+action)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	line := strings.TrimSpace(string(out))
	if i := strings.LastIndexByte(line, '\n'); i >= 0 {
		line = strings.TrimSpace(line[i+1:])
	}
	var rep cookieReport
	if err := json.Unmarshal([]byte(line), &rep); err != nil {
		return nil, fmt.Errorf("could not read the cookie check output: %w", err)
	}
	return &rep, nil
}

// stopFreebuff asks the app to close and waits for it, because Chromium holds
// the cookie jar in memory and would write it back over any changes we make.
func stopFreebuff(quiet bool) bool {
	if !freebuffRunning() {
		return true
	}
	if !quiet {
		info("Asking Freebuff to close\u2026")
	}
	cmd := exec.Command("taskkill", "/IM", "Freebuff.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
	for i := 0; i < 20; i++ {
		if !freebuffRunning() {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	// A window that will not close is not a reason to abandon the removal - but
	// it is a reason the stored theme would come straight back, because Chromium
	// writes the cookie jar on its way out. So ask harder. This is reached by
	// --reset-theme and --uninstall too, where the whole point of stopping the
	// app is that its in-memory copy of the jar must not outlive the deletion.
	if !quiet {
		info("Freebuff did not close on its own - closing it forcefully\u2026")
	}
	force := exec.Command("taskkill", "/F", "/IM", "Freebuff.exe")
	force.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = force.Run()
	for i := 0; i < 40; i++ {
		if !freebuffRunning() {
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	if !quiet {
		warn("Freebuff is still running - close it by hand and try again")
	}
	return false
}

// clearThemeCookies is the escape hatch for an install whose theme cookies are
// too big for the app to serve its own UI. Returns how many were removed.
func clearThemeCookies(install string, quiet bool) (int, bool) {
	dbs := profileCookieDBs()
	if len(dbs) == 0 {
		return 0, true
	}
	bun := bunBinary(install)
	if bun == "" {
		if !quiet {
			warn("Could not find the Bun runtime that ships with Freebuff, so the cookies were left alone")
			fmt.Printf("       Delete these files by hand: %s\n", strings.Join(dbs, ", "))
		}
		return 0, false
	}
	if !stopFreebuff(quiet) {
		return 0, false
	}
	removed := 0
	for _, db := range dbs {
		rep, err := runCookieScript(bun, db, "clear")
		if err != nil {
			if !quiet {
				warn("Could not open %s: %v", db, err)
			}
			continue
		}
		removed += rep.Cookies
		if !quiet {
			ok("Removed %d theme cookies (%d bytes) from %s", rep.Cookies, rep.Bytes, filepath.Base(filepath.Dir(filepath.Dir(db))))
		}
	}
	failed := false
	for _, db := range dbs {
		rep, err := runCookieScript(bun, db, "report")
		if err != nil {
			failed = true
			if !quiet {
				warn("Could not verify cleared cookies in %s: %v", db, err)
			}
			continue
		}
		if rep.Cookies != 0 {
			failed = true
			if !quiet {
				warn("%d Theme Studio cookies remain in %s", rep.Cookies, db)
			}
		}
	}
	return removed, !failed
}

// checkThemeCookies warns when the stored theme has grown past the size the
// app's own server will accept.
func checkThemeCookies(install string) {
	dbs := profileCookieDBs()
	if len(dbs) == 0 {
		return
	}
	bun := bunBinary(install)
	if bun == "" {
		return
	}
	for _, db := range dbs {
		rep, err := runCookieScript(bun, db, "report")
		if err != nil {
			continue
		}
		if rep.Cookies == 0 {
			continue
		}
		if rep.Bytes > cookieDangerBytes {
			warn("Theme cookies: %d cookies, %d bytes - too big for the app to stay healthy", rep.Cookies, rep.Bytes)
			fmt.Println("       Run with --reset-theme to clear them.")
			continue
		}
		fmt.Printf("  theme     %d cookies, %d bytes\n", rep.Cookies, rep.Bytes)
	}
}

// ------------------------------------------------------------------- misc ---

func freebuffRunning() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq Freebuff.exe", "/NH")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "freebuff.exe")
}

func relaunch(ui string) {
	// Freebuff.exe lives at the install root.
	exe := filepath.Join(ui, "Freebuff.exe")
	if _, err := os.Stat(exe); err != nil {
		warn("Could not find %s to relaunch", exe)
		return
	}
	info("Launching Freebuff\u2026")
	cmd := exec.Command(exe)
	cmd.Dir = ui
	if err := cmd.Start(); err != nil {
		warn("Could not launch Freebuff: %v", err)
	}
}

// ------------------------------------------------------- update survival ---

/*
 * Freebuff's own updater replaces resources/orchestrator wholesale - index.html,
 * the assets beside it and every file we wrote in there - so after every
 * Freebuff update the panel was simply gone, and the fix was to find this exe
 * and run it again by hand.
 *
 * So an install also leaves a guard behind: this same exe, copied to
 * %LOCALAPPDATA%\FreebuffThemeStudio and started at logon from the current
 * user's Run key, sitting in a quiet loop. When index.html stops carrying our
 * markers, or the engine file disappears, it writes them back.
 *
 * Two things it deliberately does not trust:
 *
 *   - the manifest inside the install. The updater deletes it along with
 *     everything else in that folder, so "was this installed?" is answered by
 *     guard.json in the guard's own folder, written on install and removed by
 *     --uninstall or --remove-watch.
 *   - a freshly written file. An update is still writing when we notice it, so
 *     an index.html younger than watchSettle is left for the next tick.
 *
 * It is user-scoped (HKCU, no admin), prints nothing, and is one process: a
 * pid file stops a second one from starting beside it.
 */

const (
	watchRunName = "FreebuffThemeStudio"
	// Long enough that an interface file is not re-read several times a second,
	// short enough that a panel wiped by an update is back before the user
	// notices it was gone.
	watchInterval = 15 * time.Second
	// An update is still writing when we first see the file.
	watchSettle  = 1500 * time.Millisecond
	detachedFlag = 0x00000008 // DETACHED_PROCESS: start without a console
)

// selfImage is this process's own executable path, resolved once at startup -
// see scheduleSelfRemoval for why it cannot be asked for later.
var selfImage string

func watchDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "FreebuffThemeStudio")
}

func watchExePath() string { return filepath.Join(watchDir(), "FreebuffThemeInjector.exe") }
func watchPidPath() string { return filepath.Join(watchDir(), "watcher.pid") }
func watchLogPath() string { return filepath.Join(watchDir(), "watcher.log") }
func guardPath() string    { return filepath.Join(watchDir(), "guard.json") }

// hideConsoleWindow is what keeps the guard from flashing a console at logon.
// A process started from the Run key gets a console of its own.
func hideConsoleWindow() {
	if runtime.GOOS != "windows" {
		return
	}
	h, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
	if h != 0 {
		_, _, _ = syscall.NewLazyDLL("user32.dll").NewProc("ShowWindow").Call(h, 0) // SW_HIDE
	}
}

// On Windows os.FindProcess opens the process and fails when the pid is gone.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}

func processName(pid int) string {
	if runtime.GOOS != "windows" {
		return ""
	}
	cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	fields := strings.Split(string(out), ",")
	if len(fields) < 2 {
		return ""
	}
	return strings.Trim(strings.TrimSpace(fields[0]), `"`)
}

func readWatchPid() int {
	b, err := os.ReadFile(watchPidPath())
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return 0
	}
	return pid
}

// stopWatcher only ever signals a process that is both recorded in our pid
// file and answers to our own executable name; a recycled pid belonging to
// something else is left alone.
func stopWatcher() {
	pid := readWatchPid()
	if pid != 0 && pid != os.Getpid() && processAlive(pid) && strings.EqualFold(processName(pid), filepath.Base(os.Args[0])) {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
			_ = p.Release()
			time.Sleep(300 * time.Millisecond)
		}
	}
	_ = os.Remove(watchPidPath())
}

func watchLog(msg string) {
	line := time.Now().Format("2006-01-02 15:04:05") + " " + msg + "\r\n"
	f, err := os.OpenFile(watchLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Size() > 64*1024 {
		_ = f.Truncate(0)
	}
	_, _ = f.WriteString(line)
}

type guardRecord struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version"`
	Install   string `json:"install"`
}

func readGuard() *guardRecord {
	b, err := os.ReadFile(guardPath())
	if err != nil {
		return nil
	}
	var g guardRecord
	if json.Unmarshal(b, &g) != nil || !g.Installed {
		return nil
	}
	return &g
}

func guardInstalled() bool { return readGuard() != nil }

func setGuard(install string) error {
	if dir := watchDir(); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	b, _ := json.MarshalIndent(map[string]any{
		"installed":   true,
		"version":     version,
		"install":     install,
		"installedAt": time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	return atomicWriteFile(guardPath(), b, 0o644)
}

func clearGuard() {
	_ = os.Remove(guardPath())
}

func runKey() string { return `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` }

func setRunEntry(command string) error {
	cmd := exec.Command("reg", "add", runKey(), "/v", watchRunName, "/t", "REG_SZ", "/d", command, "/f")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("registering the guard to start at logon: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func clearRunEntry() {
	cmd := exec.Command("reg", "delete", runKey(), "/v", watchRunName, "/f")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run() // absent is the normal case during uninstall
}

func runEntryPresent() bool {
	cmd := exec.Command("reg", "query", runKey(), "/v", watchRunName)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	return err == nil && strings.Contains(string(out), watchRunName)
}

// startWatcher launches the guard detached from this console so it does not
// die when the installer's window closes.
func startWatcher() {
	exe := watchExePath()
	if _, err := os.Stat(exe); err != nil {
		return
	}
	cmd := exec.Command(exe, "--watch", "--quiet")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedFlag}
	if err := cmd.Start(); err != nil {
		watchLog("could not start the guard: " + err.Error())
		return
	}
	_ = cmd.Process.Release()
}

// promoteWatcher puts this build of the injector where the guard runs from.
// The old copy may still be in that file, so it is stopped and moved aside
// first: a running image can be renamed on Windows, but not overwritten.
func promoteWatcher() error {
	dir := watchDir()
	if dir == "" {
		return errors.New("LOCALAPPDATA is not set")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	selfAbs, _ := filepath.Abs(self)
	dstAbs, _ := filepath.Abs(watchExePath())
	if strings.EqualFold(selfAbs, dstAbs) {
		return nil
	}
	stopWatcher()
	data, err := os.ReadFile(self)
	if err != nil {
		return fmt.Errorf("reading this executable: %w", err)
	}
	if _, err := os.Stat(watchExePath()); err == nil {
		if err := os.Rename(watchExePath(), watchExePath()+".old"); err != nil {
			return fmt.Errorf("replacing the running guard: %w", err)
		}
	}
	if err := atomicWriteFile(watchExePath(), data, 0o755); err != nil {
		return fmt.Errorf("writing the guard: %w", err)
	}
	_ = os.Remove(watchExePath() + ".old")
	return nil
}

// installWatch is what makes the panel survive a Freebuff update.
func installWatch(install string) error {
	if err := promoteWatcher(); err != nil {
		return err
	}
	if err := setGuard(install); err != nil {
		return err
	}
	// No --path on purpose: the guard re-detects the install every tick, so it
	// still finds Freebuff if it is ever reinstalled somewhere else.
	if err := setRunEntry(`"` + watchExePath() + `" --watch --quiet`); err != nil {
		return err
	}
	startWatcher()
	return nil
}

// removeWatch takes the guard away again: no logon entry, no process, no files.
func removeWatch() {
	clearRunEntry()
	stopWatcher()
	clearGuard()
	for _, f := range []string{watchPidPath(), watchExePath(), watchLogPath(), watchExePath() + ".old"} {
		if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
			// An image that is still shutting down can only be moved aside.
			_ = os.Rename(f, f+".old")
		}
	}
	// The folder belongs to this guard and nothing else.
	_ = os.RemoveAll(watchDir())
	if _, err := os.Stat(watchDir()); err == nil {
		// Something in there is still locked - a guard image that is only now
		// exiting, usually, or this one. RemoveAll stops at the first such file,
		// so the rest is left to a detached rmdir once we are gone.
		scheduleDirRemoval()
	}
}

// needsInjection says whether index.html should be written again, and why.
func needsInjection(ui string) (bool, string) {
	idx := indexPath(ui)
	st, err := os.Stat(idx)
	if err != nil {
		return false, "" // mid-update, or the folder is being replaced
	}
	if time.Since(st.ModTime()) < watchSettle {
		return false, "" // still being written; the next tick catches it
	}
	html, err := os.ReadFile(idx)
	if err != nil {
		return false, ""
	}
	_, _, injected, err := markerBounds(string(html))
	if err != nil {
		return false, "" // damaged markers need a person, not a loop
	}
	if !injected {
		return true, "the injection was removed by a Freebuff update"
	}
	if _, err := os.Stat(filepath.Join(assetsDir(ui), engineName)); err != nil {
		return true, "the engine file was removed by a Freebuff update"
	}
	return false, ""
}

// guardInstall is the install the guard is responsible for: it must never write
// into a different copy of Freebuff than the one the user installed into. If
// that path has stopped being a Freebuff install (reinstalled elsewhere), fall
// back to detection so the panel still comes back.
func guardInstall() string {
	g := readGuard()
	if g == nil {
		return ""
	}
	install := g.Install
	if install == "" || !isInstallDir(install) {
		found, err := findInstallDir("")
		if err != nil {
			return "" // no Freebuff to guard right now
		}
		install = found
	}
	return install
}

func watchTick() {
	install := guardInstall()
	if install == "" {
		return
	}
	ui := filepath.Join(install, "resources", "orchestrator", "ui")
	if readManifest(ui) == nil {
		// The updater wiped the install's own record. The guard record says we
		// belong here, so this is exactly the case to repair.
		if _, err := os.Stat(indexPath(ui)); err != nil {
			return
		}
	}
	need, why := needsInjection(ui)
	if !need {
		return
	}
	if err := inject(ui, true); err != nil {
		watchLog("inject after update failed: " + err.Error())
		return
	}
	watchLog("re-injected: " + why)
}

// runWatch is the guard loop. It never prints: it lives behind a logon entry.
func runWatch() {
	hideConsoleWindow()
	if watchDir() == "" {
		return // nowhere to keep the pid file
	}
	if pid := readWatchPid(); pid != 0 && pid != os.Getpid() && processAlive(pid) &&
		strings.EqualFold(processName(pid), filepath.Base(os.Args[0])) {
		return // a guard is already on duty
	}
	_ = os.MkdirAll(watchDir(), 0o755)
	_ = os.WriteFile(watchPidPath(), []byte(strconv.Itoa(os.Getpid())), 0o644)
	defer func() {
		// Stand down without touching a successor's record.
		if readWatchPid() == os.Getpid() {
			_ = os.Remove(watchPidPath())
		}
	}()
	for {
		// The Delete button in the Settings tab cannot remove files - it is a
		// sandboxed renderer - so it leaves a request and this process answers
		// it. Checked first, so a user who asked to be removed is not re-injected
		// on the way out. Freebuff has to close for this: Chromium holds the
		// cookie jar in memory and would otherwise write the theme straight back.
		if install := guardInstall(); install != "" {
			if _, pending := uninstallRequestPending(install); pending {
				watchLog("removing Theme Studio at the panel's request")
				ui := filepath.Join(install, "resources", "orchestrator", "ui")
				wasRunning := freebuffRunning()
				if !removeEverything(install, ui, true) {
					watchLog("the requested removal finished with errors")
				}
				// The app had to be closed to clear the stored theme, and the page it
				// had loaded is still carrying the panel in memory - which is where
				// the palette icon comes from. Start it again, so the removal is
				// something the user can see rather than a window that vanished and
				// a plugin that still looks installed.
				if wasRunning {
					relaunch(install)
				}
				return
			}
		}
		watchTick()
		time.Sleep(watchInterval)
		// Disarmed (--remove-watch) or superseded by a newer build: leave.
		if readWatchPid() != os.Getpid() {
			return
		}
	}
}

func main() {
	initColors()
	if self, err := os.Executable(); err == nil {
		selfImage = self
	}

	var (
		pathFlag        = flag.String("path", "", "Freebuff install directory (auto-detected by default)")
		uninstallFlag   = flag.Bool("uninstall", false, "remove the injected UI and restore the original index.html")
		statusFlag      = flag.Bool("status", false, "show whether Theme Studio is installed")
		themeFlag       = flag.String("theme", "", "path to a .fbtheme or .json theme to bake in as the default")
		resetFlag       = flag.Bool("reset-theme", false, "delete the stored theme cookies (the fix for an app that opens on a blank window)")
		repairFlag      = flag.Bool("repair", false, "reinstall the current files while preserving stored theme settings")
		restartFlag     = flag.Bool("restart", false, "close Freebuff if it is running and start it again")
		openFlag        = flag.Bool("open", false, "open the UI folder in Explorer")
		quietFlag       = flag.Bool("quiet", false, "less output")
		watchFlag       = flag.Bool("watch", false, "run quietly in the background, re-injecting after Freebuff updates")
		removeWatchFlag = flag.Bool("remove-watch", false, "stop the background guard and remove it from logon")
	)
	flag.Usage = func() {
		banner()
		fmt.Printf("Usage: %s [options]\n\n", filepath.Base(os.Args[0]))
		fmt.Println("  Run with no options to install the theme panel into Freebuff Desktop.")
		fmt.Println("  Then open Freebuff and click the palette icon in its sidebar rail.")
		fmt.Println("  Its Settings tab has a Delete button that removes Theme Studio again.")
		fmt.Println()
		flag.PrintDefaults()
		fmt.Println()
		fmt.Println("Examples:")
		fmt.Println("  FreebuffThemeInjector.exe")
		fmt.Println("  FreebuffThemeInjector.exe --restart")
		fmt.Println("  FreebuffThemeInjector.exe --theme my-theme.json")
		fmt.Println("  FreebuffThemeInjector.exe --status")
		fmt.Println("  FreebuffThemeInjector.exe --remove-watch")
		fmt.Println("  FreebuffThemeInjector.exe --repair --restart")
		fmt.Println("  FreebuffThemeInjector.exe --uninstall")
		fmt.Println()
		fmt.Println("If Freebuff opens on an empty grey window, run --reset-theme. That is")
		fmt.Println("caused by a theme too big for the app to carry, and clearing it fixes it.")
	}
	flag.Parse()

	quiet := *quietFlag

	// The guard and its removal need no install detection of their own: the
	// guard re-detects every tick, and removal touches only this user's files.
	if *watchFlag {
		runWatch()
		return
	}
	if *removeWatchFlag {
		removeWatch()
		if !quiet {
			banner()
			ok("Background guard stopped and removed (logon entry, process and files)")
		}
		return
	}

	if !quiet {
		banner()
	}

	install, err := findInstallDir(*pathFlag)
	if err != nil {
		warn("%v", err)
		os.Exit(1)
	}
	ui := filepath.Join(install, "resources", "orchestrator", "ui")

	switch {
	case *statusFlag:
		status(ui, install)
		return

	case *resetFlag:
		if !quiet {
			step("Clearing the stored theme")
		}
		if _, ok := clearThemeCookies(install, quiet); !ok {
			os.Exit(1)
		}
		fmt.Println()
		ok("Theme cookies cleared. Freebuff should open normally again.")
		if *restartFlag {
			relaunch(install)
		}
		return

	case *uninstallFlag:
		if !quiet {
			step("Removing Theme Studio")
		}
		// The same removal the panel's Delete button performs, so the two cannot
		// drift apart. A failed cookie cleanup is still reported as a failure -
		// it must not read as a clean uninstall - but the injected files come out
		// either way, because that is what the user asked for.
		if !removeEverything(install, ui, quiet) {
			os.Exit(1)
		}
		fmt.Println()
		ok("Freebuff is back to stock. Restart it if it is running.")
		if *restartFlag {
			relaunch(install)
		}
		return
	}

	if !quiet {
		step("Found Freebuff at %s", install)
		if fallback := runningExecutable(); fallback != "" && filepath.Dir(fallback) != install {
			info("A running Freebuff is at %s", filepath.Dir(fallback))
		}
	}

	if *themeFlag != "" {
		if !quiet {
			step("Baking theme %s", *themeFlag)
		}
		if err := os.MkdirAll(assetsDir(ui), 0o755); err != nil {
			warn("%v", err)
			os.Exit(1)
		}
		if err := bakeTheme(ui, *themeFlag); err != nil {
			warn("%v", err)
			os.Exit(1)
		}
		if !quiet {
			ok("Theme will be the default for new sessions")
		}
	}

	if *repairFlag {
		if !quiet {
			step("Repairing the installed files")
		}
	}
	if !quiet {
		step("Installing theme engine")
	}
	if err := inject(ui, quiet); err != nil {
		warn("%v", err)
		os.Exit(1)
	}
	if !quiet {
		ok("Injected into resources/orchestrator/ui/index.html")
		ok("Wrote assets/%s (%d bytes)", engineName, len(engineJS))
		ok("Wrote assets/%s (%d bytes)", communityName, len(communityJS))
	}

	// The panel comes back by itself after Freebuff updates itself. Without a
	// guard, an update replaced index.html and the panel was simply gone.
	if err := installWatch(install); err != nil {
		warn("Could not set up the background guard: %v", err)
		info("       Run this installer again after a Freebuff update to restore the panel.")
	} else if !quiet {
		ok("Guarding against Freebuff updates (background, %s)", watchDir())
		info("   The panel re-installs itself after an update; --remove-watch takes this away.")
	}

	// Repair only refreshes extension files. Theme data is preserved; use the
	// explicit --reset-theme flag when the user wants to clear stored settings.

	if *openFlag {
		_ = exec.Command("explorer.exe", ui).Start()
	}

	if quiet {
		fmt.Printf("installed: %s\n", ui)
	} else {
		fmt.Println()
		fmt.Printf("%sDone.%s\n", colBold+colGreen, colReset)
		fmt.Println()
		fmt.Println("  Open Freebuff - a " + colBold + "palette icon" + colReset + " appears in the sidebar rail.")
		fmt.Println("  Click it for presets, per-token colour pickers, layout and raw CSS.")
		fmt.Println()
		fmt.Printf("  %sThe theme is remembered between launches; a background picture lasts for the session.%s\n", colDim, colReset)
		fmt.Printf("  %sBlank grey window? Run this again with --reset-theme.%s\n", colDim, colReset)
		fmt.Printf("  %sCtrl+Alt+Shift+F reopens the page, Esc closes it.%s\n", colDim, colReset)
		fmt.Printf("  %sUnofficial extension: not made by, or endorsed by, Freebuff.%s\n", colDim, colReset)
		fmt.Println()
	}

	if freebuffRunning() {
		if !quiet {
			warn("Freebuff is already running.")
			fmt.Println("       The new panel appears the next time the UI loads - press Ctrl+R in Freebuff,")
			fmt.Println("       or run this again with --restart to relaunch it cleanly.")
		}
		if *restartFlag {
			if !quiet {
				step("Relaunching Freebuff")
			}
			if !stopFreebuff(quiet) {
				os.Exit(1)
			}
			relaunch(install)
		}
	} else if *restartFlag {
		if !quiet {
			step("Starting Freebuff")
		}
		relaunch(install)
	}
}
