"""Browser checks for the public research-map page. Requires Python Playwright + Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import re
import os
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = Path(os.environ.get('ILI_MAP_SCREENSHOTS', str(Path(tempfile.gettempdir())/'ili-map-preview')))
SCREENSHOTS.mkdir(parents=True,exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


data = json.loads((ROOT / 'infrastructure-map/data/research-map.json').read_text(encoding='utf-8'))
forbidden = re.compile(r'owner|mailing|parcel.?id|legal.?description|^(pin|geocode)$', re.I)


def audit(value):
    if isinstance(value, dict):
        for key, child in value.items():
            assert not forbidden.search(key), key
            audit(child)
    elif isinstance(value, list):
        for child in value:
            audit(child)
    elif isinstance(value, str):
        assert not re.search(r'(?:mail\.google\.com|[a-z]:\\|@gmail\.com|\.codex)', value, re.I), value


audit(data)
assert len(data['sites']) == 10
assert len(data['lakes']) == 2
assert data['cyrusoneFootprint']['properties']['acres'] == 280
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
results = {'public_dataset_audit': 'passed'}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1100})
        # No external service is needed to render or interact with the map.
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
        page = context.new_page()
        errors, failed = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: failed.append(r.url) if r.status >= 400 and r.url.startswith(base) else None)
        page.goto(base + '/')
        page.get_by_role('link', name='Explore Water & Infrastructure', exact=True).click()
        page.wait_for_selector('.map-label')
        assert page.url == base + '/infrastructure-map/'
        assert page.locator('h1').count() == 1
        svg = page.locator('.map-surface')
        def state():
            return svg.evaluate('(s)=>({k:+s.dataset.zoom,x:+s.dataset.panX,y:+s.dataset.panY})')
        def settle():
            page.wait_for_timeout(150)
        box = svg.bounding_box()
        x, y = box['x'] + box['width']*.52, box['y'] + 200
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 90, y + 45, steps=12)
        page.mouse.up()
        settle()
        assert state() == {'k':1,'x':90,'y':45}, state()
        pan = state()
        page.locator('circle[data-tooltip*="CyrusOne"]').click()
        settle()
        assert state() == pan
        assert 'CyrusOne' in page.locator('#water-map-name').inner_text()
        assert page.locator('#water-map-sources a[href="../sangamon-land-dashboard.html"]').count() == 1
        page.get_by_role('button', name='Zoom in', exact=True).click()
        settle()
        assert state()['k'] == 1.5
        saved = state()
        page.reload()
        page.wait_for_selector('.map-label')
        assert state() == saved
        page.get_by_role('button', name='Reset view').click()
        settle()
        assert state() == {'k':1,'x':0,'y':0}
        box = svg.bounding_box()
        page.mouse.move(box['x']+box['width']/2, box['y']+200)
        page.mouse.wheel(0,-400)
        page.wait_for_timeout(400)
        assert state()['k'] > 1.5
        page.locator('#water-map-area').select_option('springfield')
        settle()
        assert state() == {'k':1,'x':0,'y':0}
        page.locator('#water-map-selection').select_option('site-memorial')
        settle()
        assert 'Memorial' in page.locator('#water-map-name').inner_text()
        results['pan_zoom_selection_and_saved_state'] = 'passed'
        # A Chatham link must open Chatham even if a different selection was saved.
        page.goto(base + '/chatham-il-land-for-sale-research.html')
        page.get_by_role('link', name='Explore Chatham infrastructure').click()
        page.wait_for_selector('.map-label')
        assert page.locator('#water-map-name').inner_text() == 'Chatham'
        assert page.locator('#water-map-area').input_value() == 'local'
        page.locator('#water-map-sources a[href="../chatham-il-land-for-sale-research.html"]').click()
        page.wait_for_url('**/chatham-il-land-for-sale-research.html')
        assert page.url.endswith('/chatham-il-land-for-sale-research.html')
        page.goto(base + '/sangamon-land-dashboard.html')
        page.get_by_role('link', name='Explore water & infrastructure').click()
        page.wait_for_selector('.map-label')
        results['land_index_navigation_and_deep_link'] = 'passed'
        page.locator('#water-map-area').select_option('water')
        settle()
        page.screenshot(path=str(SCREENSHOTS/'infrastructure-map-desktop.png'), full_page=True)
        for width in [768,390,320]:
            page.set_viewport_size({'width':width,'height':1000})
            settle()
            assert page.locator('body').evaluate('(b)=>b.scrollWidth<=innerWidth'), width
            assert page.locator('#water-map-help').is_visible()
        page.screenshot(path=str(SCREENSHOTS/'infrastructure-map-mobile.png'), full_page=True)
        mobile = browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        mobile.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
        mp = mobile.new_page()
        mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(base+'/infrastructure-map/')
        mp.wait_for_selector('.map-label')
        ms = mp.locator('.map-surface')
        ms.scroll_into_view_if_needed()
        b = ms.bounding_box()
        cx, cy = b['x']+b['width']/2, b['y']+180
        cdp = mobile.new_cdp_session(mp)
        def touch(points, kind):
            cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i} for i,(x,y) in enumerate(points)]})
        touch([(cx-35,cy),(cx+35,cy)],'touchStart')
        for i in range(1,7):
            touch([(cx-35-5*i,cy),(cx+35+5*i,cy)],'touchMove')
            mp.wait_for_timeout(25)
        touch([],'touchEnd')
        mp.wait_for_timeout(200)
        assert float(ms.get_attribute('data-zoom')) > 1.5
        assert not errors, errors
        assert not failed, failed
        assert page.locator('#water-map-error').is_hidden()
        results['responsive_and_touch_gestures'] = 'passed'
        results['javascript_errors'] = errors
        results['failed_local_requests'] = failed
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print(json.dumps(results,indent=2))
