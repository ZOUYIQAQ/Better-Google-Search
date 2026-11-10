import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/ai-failure-layout'
OUT.mkdir(parents=True,exist_ok=True)
# 保留故障页中真实存在的原生负上边距和全部布局层级，测量提示行相对卡片的上下留白。
async def main():
    current=(ROOT/'search-quiet-cards.user.js').read_text()
    runtime=await async_playwright().start()
    browser=await runtime.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE'))
    page=await browser.new_page()
    rows=[]
    html='''<html data-gqc-active="true"><body style="margin:0"><div id="rcnt" class="gqc-layout"><div class="SLPe5b M8OgIe gqc-top gqc-module gqc-feature gqc-ai-unavailable"><div class="NmCNL"><div class="ZpdpPe"></div></div><div><div id="Odp5De"><div class="Kevs9"><div><div class="Wm5I1e SePcAf" id="eKIzJc"><div class="YzCcne" style="margin-bottom:30px"><div class="hdzaWe" style="position:relative"><div id="dEwkXc"><div><div data-async-type="folsrch" data-lhcontainer="1" id="B2Jtyd" style="margin-top:-8px"><div class="X6JNf VtNldd"><div class="s7d4ef"><div class="OZ9ddf WAUd4" style="margin-top:-8px"><div class="heWuVc"><div class="nk9vdc GYaNDc"><span><svg width="24" height="24" viewBox="0 0 24 24"><path fill="#3179ed" d="M12 0Q12 12 24 12Q12 12 12 24Q12 12 0 12Q12 12 12 0"/></svg></span><span class="YWpX0d"><span>目前无法生成 AI 概要。请稍后重试。</span></span></div></div></div></div></div><div class="KMCbD"></div></div></div></div></div></div></div></div></div></div></div></div></div></body></html>'''
    native='.OZ9ddf{max-height:32px;display:flex;align-items:center;padding-bottom:16px}.heWuVc{display:contents}.nk9vdc{display:flex;gap:16px;align-items:center}.YWpX0d{font:16px/24px Arial,sans-serif;flex:1}.nk9vdc svg{display:block}.ZpdpPe:empty{padding-bottom:16px}'
    try:
        for width in [1920,990,390]:
            await page.set_viewport_size({'width':width,'height':400})
            for label,source in [('修复后',current)]:
                await page.set_content(html,wait_until='domcontentloaded',timeout=10000)
                await page.add_style_tag(content=native)
                css=source.split('  const CSS = `',1)[1].split('\n`;',1)[0]
                await page.add_style_tag(content=css)
                data=await page.evaluate('''() => {const c=document.querySelector('.gqc-ai-unavailable').getBoundingClientRect(),r=document.querySelector('.nk9vdc').getBoundingClientRect();return {卡片高度:c.height,上留白:r.top-c.top,下留白:c.bottom-r.bottom,中心偏差:(r.top+r.bottom-c.top-c.bottom)/2}}''')
                assert data['下留白']==data['上留白'] and data['中心偏差']==0,data
                rows.append({'宽度':width,'阶段':label,**data})
                await page.screenshot(path=str(OUT/f'{label}-{width}.png'))
        (OUT/'verification.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
        print(json.dumps(rows,ensure_ascii=False))
    finally:
        await browser.close()
        await runtime.stop()
asyncio.run(main())
