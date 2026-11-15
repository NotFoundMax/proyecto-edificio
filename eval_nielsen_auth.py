import json, os, sys, traceback
from playwright.sync_api import sync_playwright

BASE = os.getenv("EVAL_URL", "http://localhost:8080/")
EMAIL = os.getenv("EVAL_EMAIL")
PASSWORD = os.getenv("EVAL_PASSWORD")
OUT = os.getenv("EVAL_OUT", "/tmp/nielsen-eval-auth")
CHROME = os.getenv("CHROME_PATH", "/home/max/.local/bin/chromium")
os.makedirs(OUT, exist_ok=True)

if not EMAIL or not PASSWORD:
    print("Falta EVAL_EMAIL o EVAL_PASSWORD (variables de entorno).", file=sys.stderr)
    print("Ej: EVAL_EMAIL='tu@correo' EVAL_PASSWORD='tu_clave' python3 eval_nielsen_auth.py", file=sys.stderr)
    sys.exit(2)

results = {"console": [], "page_errors": [], "screens": [], "checks": {}, "fatal": None}

def snap(page, name, note=""):
    path = os.path.join(OUT, f"{name}.png")
    try:
        page.screenshot(path=path, full_page=True)
    except Exception as e:
        path = f"ERROR: {e}"
    results["screens"].append({"name": name, "path": path, "url": getattr(page, 'url', ''), "note": note})
    return path

def safe_click(page, selector, timeout=2500):
    try:
        loc = page.locator(selector).first
        if loc.count() > 0 and loc.is_visible():
            loc.click(timeout=timeout)
            page.wait_for_timeout(800)
            return True
    except Exception:
        pass
    return False

def try_click_any(page, selectors, timeout=2500):
    for s in selectors:
        if safe_click(page, s, timeout):
            return s
    return None

def write_result():
    try:
        with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

try:
    with sync_playwright() as p:
        launch_args = {"headless": True}
        if CHROME and os.path.exists(CHROME):
            launch_args["executable_path"] = CHROME
        browser = p.chromium.launch(**launch_args)
        context = browser.new_context(viewport={"width": 1400, "height": 900}, locale="es-PE")
        page = context.new_page()
        page.on("console", lambda msg: results["console"].append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda err: results["page_errors"].append(str(err)))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1200)
        snap(page, "01-login", "Pantalla de login")

        page.locator("#login-email").fill(EMAIL)
        page.locator("#login-password").fill(PASSWORD)
        try_click_any(page, ["#btn-login-submit", "button[type='submit']", "form#form-login button:has-text('Ingresar')"])
        page.wait_for_timeout(3500)
        snap(page, "02-post-login", "Después de login")

        try_click_any(page, [".edificio-item", "[data-edificio-id]", "button:has-text('Entrar')", "button:has-text('Continuar')", "text=Los Castaños"])
        page.wait_for_timeout(1500)
        try_click_any(page, ["#lista-edificios .list-item", "#lista-edificios button", ".list-container .list-item"])
        page.wait_for_timeout(2000)
        snap(page, "03-inicio-app", "Inicio de app tras acceso")

        nav = [
            ("Inicio", "04-dashboard"),
            ("Dptos", "05-departamentos"),
            ("Gastos", "06-gastos"),
            ("Cálculo", "07-calculo"),
            ("Informes", "08-informes"),
        ]
        for label, name in nav:
            try:
                try_click_any(page, [f"#bottom-nav button:has-text('{label}')", f".nav-item:has-text('{label}')", f"nav button:has-text('{label}')"])
                page.wait_for_timeout(1500)
                snap(page, name, f"Pantalla {label}")

                if label == "Gastos":
                    for tab, tname in [("Recurrentes","06a-gastos-recurrentes"), ("Del mes","06b-gastos-delmes"), ("Consumos","06c-gastos-consumos")]:
                        if try_click_any(page, [f"[role='tab']:has-text('{tab}')", f"button:has-text('{tab}')"], 1500):
                            page.wait_for_timeout(900); snap(page, tname, f"Gastos - {tab}")
                    try_click_any(page, ["[role='tab']:has-text('Consumos')", "button:has-text('Consumos')"], 1500)
                    page.wait_for_timeout(800)
                    for tab, tname in [("Agua","06d-consumo-agua"), ("Gas","06e-consumo-gas"), ("Luz","06f-consumo-luz")]:
                        if try_click_any(page, [f"#panel-consumos [role='tab']:has-text('{tab}')", f"#panel-consumos button:has-text('{tab}')"], 1500):
                            page.wait_for_timeout(900); snap(page, tname, f"Consumo - {tab}")
                if label == "Dptos":
                    if try_click_any(page, [".btn-depto-historial", "button:has-text('Estado de cuenta')", "button[title*='Estado']"], 1500):
                        page.wait_for_timeout(900); snap(page, "05b-estado-cuenta", "Modal/estado de cuenta")
                        try_click_any(page, [".modal .btn-cancel", "button:has-text('Cerrar')", ".modal .icon-btn", "#modal-estado-cuenta button"], 1200)
                        page.wait_for_timeout(500)
                if label == "Cálculo":
                    if try_click_any(page, ["button:has-text('Registrar')", "button:has-text('abono')", ".btn-pago"], 1500):
                        page.wait_for_timeout(900); snap(page, "07b-modal-pago", "Modal pago/abono")
                        try_click_any(page, ["button:has-text('Cancelar')", ".modal .btn-cancel"], 1200)
            except Exception as e:
                results["page_errors"].append(f"nav:{label}:{e}")

        try_click_any(page, [f"#bottom-nav button:has-text('Inicio')", f".nav-item:has-text('Inicio')"])
        page.wait_for_timeout(1200)
        snap(page, "09-dashboard-final", "Dashboard con datos")

        # móvil
        try:
            context_m = browser.new_context(viewport={"width": 390, "height": 844}, locale="es-PE")
            page_m = context_m.new_page()
            page_m.on("console", lambda msg: results["console"].append({"type": msg.type, "text": msg.text, "viewport": "mobile"}))
            page_m.on("pageerror", lambda err: results["page_errors"].append(f"mobile: {err}"))
            page_m.goto(BASE, wait_until="networkidle", timeout=30000)
            page_m.wait_for_timeout(1500)
            try:
                if page_m.locator("#login-email").count() and page_m.locator("#login-email").is_visible():
                    page_m.locator("#login-email").fill(EMAIL)
                    page_m.locator("#login-password").fill(PASSWORD)
                    try_click_any(page_m, ["#btn-login-submit", "button[type='submit']"])
                    page_m.wait_for_timeout(3500)
                try_click_any(page_m, [".edificio-item", "[data-edificio-id]", "text=Los Castaños"])
                page_m.wait_for_timeout(1500)
            except Exception:
                pass
            snap(page_m, "10-mobile-inicio", "Móvil - inicio")
            for label, name in [("Inicio","11-mobile-dashboard"),("Gastos","12-mobile-gastos"),("Cálculo","13-mobile-calculo"),("Dptos","14-mobile-dptos"),("Informes","15-mobile-informes")]:
                try_click_any(page_m, [f"#bottom-nav button:has-text('{label}')", f".nav-item:has-text('{label}')"])
                page_m.wait_for_timeout(1200); snap(page_m, name, f"Móvil - {label}")
            context_m.close()
        except Exception as e:
            results["page_errors"].append(f"mobile:{e}")

        results["checks"] = {
            "url": page.url,
            "title": page.title(),
            "nav_visible": page.locator("#bottom-nav").is_visible() if page.locator("#bottom-nav").count() else False,
            "nav_labels": page.locator("#bottom-nav .nav-label").all_inner_texts()[:10],
            "console_errors": len([c for c in results["console"] if c.get("type") == "error"]),
            "page_errors": len(results["page_errors"]),
            "aria_live_count": page.locator("[aria-live]").count(),
            "inputs_count": page.locator("input, select, textarea").count(),
            "labels_count": page.locator("label").count(),
            "modals_count": page.locator(".modal, [role='dialog']").count(),
            "screens_visibility": {},
            "text_sample": page.inner_text("body")[:5000],
        }
        for scr in ["dashboard","propietarios","gastos","calculo","informes","consumos","configuracion","propietario","login","acceso","pendiente"]:
            try:
                results["checks"]["screens_visibility"][scr] = page.locator(f"#screen-{scr}").is_visible()
            except Exception:
                results["checks"]["screens_visibility"][scr] = None

        context.close()
        browser.close()
except Exception:
    results["fatal"] = traceback.format_exc()
finally:
    write_result()

print(json.dumps({
    "out": OUT,
    "screens": [s["name"] for s in results.get("screens", [])],
    "console_errors": results.get("checks", {}).get("console_errors"),
    "page_errors_count": len(results.get("page_errors", [])),
    "fatal": bool(results.get("fatal")),
}, ensure_ascii=False, indent=2))
