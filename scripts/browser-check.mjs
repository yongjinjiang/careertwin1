import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseURL = process.env.CAREERTWIN_BASE_URL ?? 'http://127.0.0.1:5181'
const output = new URL('../artifacts/browser/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch(process.env.CAREERTWIN_BROWSER_EXECUTABLE
  ? { headless: true, executablePath: process.env.CAREERTWIN_BROWSER_EXECUTABLE }
  : { headless: true, channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage()
const errors = []
const outsideRequests = []
const checks = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (!request.url().startsWith(baseURL) && !request.url().startsWith('data:')) outsideRequests.push(request.url()) })
await context.addInitScript(() => {
  const original = IDBFactory.prototype.open
  window.__profileOpens = []
  IDBFactory.prototype.open = function (name, version) {
    window.__profileOpens.push(name)
    return original.call(this, name, version)
  }
})
const ready = () => page.getByText('本地存储已就绪', { exact: false }).waitFor()
const notes = () => page.getByRole('textbox', { name: /^项目原文/ })
const name = () => page.getByRole('textbox', { name: /^项目名称/ })
const saveNew = () => page.getByRole('button', { name: /^Save as new/ })
const newMode = () => page.getByRole('button', { name: '切换为新建项目' }).click()
const skip = () => page.getByRole('button', { name: '跳过 / 取消补充' }).click()
const projects = () => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的 Profile' }).click()
const basic = () => page.getByRole('navigation', { name: 'Profile 分类' }).getByRole('link', { name: 'Basic Info', exact: true }).click()
const success = text => page.getByRole('status').filter({ hasText: text }).waitFor()
const records = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('careertwin1-profile', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const db = request.result
    const tx = db.transaction('records')
    const get = tx.objectStore('records').getAll()
    get.onsuccess = () => resolve(get.result)
    tx.oncomplete = () => db.close()
  }
}))
const article = title => page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

try {
  await page.goto(baseURL); await ready()
  await page.evaluate(async () => {
    for (const dbName of ['careertwin', 'careertwin-shares']) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbName === 'careertwin' ? 3 : 1)
        request.onupgradeneeded = () => request.result.createObjectStore('sentinel').put('unchanged', 'old')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => { request.result.close(); resolve() }
      })
    }
    window.__profileOpens = []
  })
  const personalText = '  个人工具项目。\nBuilt a CLI for a synthetic example.  '
  await name().fill('合成个人项目'); await notes().fill(personalText)
  await saveNew().evaluate(button => { button.click(); button.click() })
  await success('原文已保存'); await skip()
  let data = await records()
  assert.equal(data.length, 1); assert.equal(data[0].originalText, personalText)
  const personalId = data[0].id
  checks.push('rapid duplicate create, raw text and metadata skip')

  await newMode(); await name().fill('合成单位项目'); await notes().fill('Built a research platform for synthetic examples.')
  await saveNew().click(); await success('原文已保存')
  await page.getByRole('textbox', { name: /^单位/ }).fill('Example Lab')
  await page.getByRole('textbox', { name: /^开始年份/ }).fill('2022')
  await page.getByRole('checkbox', { name: '至今', exact: true }).check()
  await page.getByRole('button', { name: '保存补充信息' }).click(); await success('补充信息已保存')
  const organizationRecord = (await records()).find(record => record.displayName === '合成单位项目')
  assert.equal(organizationRecord.organization, 'Example Lab'); assert.equal(organizationRecord.isCurrent, true)

  await newMode(); await notes().fill('\n研究阶段概括\nConducted experiments and documented results.')
  await saveNew().click(); await success('原文已保存'); await skip()
  assert.equal((await records()).filter(record => record.type === 'project').length, 3)
  checks.push('organization/ongoing metadata and deterministic fallback phase record')

  await projects(); await article('合成个人项目').getByText('查看全文', { exact: true }).click()
  assert.equal(await article('合成个人项目').locator('.original-text').textContent(), personalText)
  await article('合成个人项目').getByRole('button', { name: /Edit/ }).click()
  assert.equal(await notes().inputValue(), personalText)
  await notes().fill(personalText + '\nUpdated contribution.')
  await page.getByRole('button', { name: /^Save changes/ }).click(); await success('项目已保存')
  const editedPersonal = (await records()).find(record => record.id === personalId)
  checks.push('full raw-text browse and shared-editor update')

  await newMode(); await name().fill('单位项目更新'); await notes().fill('New source notes for the explicitly selected project.')
  await page.getByRole('button', { name: /^Overwrite existing/ }).click()
  const target = page.getByRole('combobox', { name: '选择要覆盖的项目' })
  assert.equal(await target.inputValue(), '')
  await target.selectOption(organizationRecord.id)
  await page.getByRole('button', { name: '覆盖：合成单位项目', exact: true }).click(); await success('项目已保存')
  data = await records()
  assert.equal(data.length, 3)
  const overwritten = data.find(record => record.id === organizationRecord.id)
  for (const key of ['id', 'createdAt', 'organization', 'startYear', 'endYear', 'isCurrent']) assert.deepEqual(overwritten[key], organizationRecord[key])
  assert.deepEqual(data.find(record => record.id === personalId), editedPersonal)
  checks.push('explicit overwrite target, stable ID/count/metadata and untouched other records')

  await newMode(); await notes().fill('Blank-name overwrite keeps the existing name.')
  await page.getByRole('button', { name: /^Overwrite existing/ }).click()
  await page.getByRole('combobox', { name: '选择要覆盖的项目' }).selectOption(organizationRecord.id)
  await page.getByRole('button', { name: '覆盖：单位项目更新', exact: true }).click(); await success('项目已保存')
  const blankNameOverwrite = (await records()).find(record => record.id === organizationRecord.id)
  assert.equal(blankNameOverwrite.displayName, '单位项目更新')
  assert.equal(blankNameOverwrite.originalText, 'Blank-name overwrite keeps the existing name.')
  assert.equal((await records()).length, 3)
  checks.push('blank-name overwrite keeps the target name')

  await newMode(); await saveNew().click()
  await page.getByRole('alert').filter({ hasText: '请输入项目原文' }).waitFor()
  await name().fill('长度边界项目'); await notes().fill('中'.repeat(501)); await saveNew().click()
  await page.getByRole('alert').filter({ hasText: '超过 500' }).waitFor()
  assert.equal((await notes().inputValue()).length, 501); assert.equal((await records()).length, 3)
  await notes().fill('中'.repeat(500)); await saveNew().click(); await success('原文已保存'); await skip()
  await projects()
  page.once('dialog', dialog => dialog.dismiss())
  await article('长度边界项目').getByRole('button', { name: '删除', exact: true }).click()
  assert.equal((await records()).length, 4)
  page.once('dialog', dialog => dialog.accept())
  await article('长度边界项目').getByRole('button', { name: '删除', exact: true }).click()
  await success('已删除：长度边界项目'); assert.equal((await records()).length, 3)
  checks.push('empty and 501 rejection, exact 500, cancel and confirm deletion')

  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await notes().fill('Unsaved navigation example')
  page.once('dialog', dialog => dialog.dismiss()); await projects()
  assert.equal(await notes().inputValue(), 'Unsaved navigation example')
  page.once('dialog', dialog => dialog.accept()); await projects()
  await basic()
  const basicText = 'Synthetic education and contact information.\n' + '中'.repeat(601)
  await page.getByRole('textbox', { name: '基本信息原文' }).fill(basicText)
  await page.getByRole('button', { name: '保存 Basic Info' }).click(); await success('基本信息已保存')
  await page.getByRole('textbox', { name: '基本信息原文' }).fill(basicText + '\nUpdated.')
  await page.getByRole('button', { name: '保存 Basic Info' }).click(); await success('基本信息已保存')
  assert.equal((await records()).filter(record => record.type === 'basic_info').length, 1)
  assert.equal((await records()).filter(record => record.type === 'project').length, 3)
  assert((await page.evaluate(() => window.__profileOpens)).every(value => value === 'careertwin1-profile'))
  await page.reload(); await ready()
  assert.equal(await page.getByRole('textbox', { name: '基本信息原文' }).inputValue(), basicText + '\nUpdated.')
  await projects(); assert.equal(await page.locator('article').count(), 3)
  await page.screenshot({ path: new URL('profile-desktop.png', output).pathname, fullPage: true })
  checks.push('unsaved navigation guard, long singleton Basic Info, refresh persistence')

  const hashIs = hash => page.waitForFunction(expected => location.hash === expected, hash)
  const traverse = async direction => { await (direction === 'back' ? page.goBack({ waitUntil: 'commit' }) : page.goForward({ waitUntil: 'commit' })).catch(() => {}) }
  const home = () => page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '主页' }).click()
  await home(); await notes().fill('Back-cancel synthetic draft')
  page.once('dialog', dialog => dialog.dismiss()); await traverse('back'); await hashIs('#/')
  assert.equal(await notes().inputValue(), 'Back-cancel synthetic draft')
  page.once('dialog', dialog => dialog.accept()); await traverse('back'); await hashIs('#/profile/projects')
  await page.getByRole('heading', { name: /^项目经历/ }).waitFor()
  await basic(); await home(); await traverse('back'); await hashIs('#/profile/basic-info')
  await page.getByRole('textbox', { name: '基本信息原文' }).fill(basicText + '\nForward-cancel draft')
  page.once('dialog', dialog => dialog.dismiss()); await traverse('forward'); await hashIs('#/profile/basic-info')
  assert.equal(await page.getByRole('textbox', { name: '基本信息原文' }).inputValue(), basicText + '\nForward-cancel draft')
  page.once('dialog', dialog => dialog.accept()); await traverse('forward'); await hashIs('#/')
  await traverse('back'); await hashIs('#/profile/basic-info')
  assert.equal(await page.getByRole('textbox', { name: '基本信息原文' }).inputValue(), basicText + '\nUpdated.')
  await projects()
  checks.push('browser Back/Forward cancel keeps draft and history entries; accepted traversal reaches them')

  const entryIndex = () => page.evaluate(() => history.state?.careerTwin1Index)
  const indexIs = value => page.waitForFunction(expected => history.state?.careerTwin1Index === expected, value)
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await name().fill('同 hash 历史项目'); await notes().fill('Synthetic project for same-hash history traversal.')
  await saveNew().click(); await success('原文已保存'); await skip()
  await newMode()
  const newModeIndex = await entryIndex()
  await traverse('back'); await indexIs(newModeIndex - 1); await hashIs('#/')
  await notes().fill('Same-hash synthetic draft')
  let prompts = 0
  let answer = false
  const onDialog = dialog => { prompts += 1; void (answer ? dialog.accept() : dialog.dismiss()) }
  page.on('dialog', onDialog)
  await traverse('back')
  await page.waitForTimeout(300)
  await indexIs(newModeIndex - 1); await hashIs('#/')
  assert.equal(prompts, 1)
  assert.equal(await notes().inputValue(), 'Same-hash synthetic draft')
  answer = true
  await traverse('back'); await hashIs('#/profile/projects')
  await page.getByRole('heading', { name: /^项目经历/ }).waitFor()
  assert.equal(prompts, 2)
  page.off('dialog', onDialog)
  page.once('dialog', dialog => dialog.accept()); await article('同 hash 历史项目').getByRole('button', { name: '删除', exact: true }).click()
  await success('已删除：同 hash 历史项目')
  assert.equal((await records()).filter(record => record.type === 'project').length, 3)
  checks.push('same-hash Back keeps history positions; cancel restores the original entry and the next accepted Back reaches Profile')

  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await name().fill('事务失败重试项目'); await notes().fill('Keep this source after a transaction abort.')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (...args) {
      IDBObjectStore.prototype.add = original
      const request = original.apply(this, args)
      this.transaction.abort()
      return request
    }
  })
  await saveNew().click(); await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor()
  assert.equal(await notes().inputValue(), 'Keep this source after a transaction abort.')
  assert.equal((await records()).filter(record => record.type === 'project').length, 3)
  await saveNew().click(); await success('原文已保存'); await skip()
  assert.equal((await records()).filter(record => record.type === 'project').length, 4)
  await projects()
  page.once('dialog', dialog => dialog.accept()); await article('事务失败重试项目').getByRole('button', { name: '删除', exact: true }).click()
  await success('已删除：事务失败重试项目')
  checks.push('real IndexedDB transaction abort, retained input and single-record retry')

  assert((await page.evaluate(() => window.__profileOpens)).every(value => value === 'careertwin1-profile'))
  const old = await page.evaluate(async () => {
    const result = []
    for (const name of ['careertwin', 'careertwin-shares']) {
      result.push(await new Promise((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('sentinel')
          const get = transaction.objectStore('sentinel').get('old')
          get.onsuccess = () => resolve({ name, version: db.version, value: get.result, stores: [...db.objectStoreNames] })
          transaction.oncomplete = () => db.close()
        }
      }))
    }
    return result
  })
  assert.deepEqual(old, [
    { name: 'careertwin', version: 3, value: 'unchanged', stores: ['sentinel'] },
    { name: 'careertwin-shares', version: 1, value: 'unchanged', stores: ['sentinel'] },
  ])
  checks.push('legacy sentinel databases untouched by manual workflows')

  const reopened = await context.newPage()
  await reopened.goto(baseURL + '/#/profile/projects')
  await reopened.getByText('本地存储已就绪', { exact: false }).waitFor()
  assert.equal(await reopened.locator('article').count(), 3)
  await reopened.close()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await notes().fill('Mobile synthetic project')
  await page.screenshot({ path: new URL('editor-mobile.png', output).pathname, fullPage: true })
  page.once('dialog', dialog => dialog.accept()); await projects()
  await basic(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  checks.push('new-tab reopening and 375px editor/Profile/Basic Info layout')

  assert.deepEqual(errors, []); assert.deepEqual(outsideRequests, [])
  const report = { result: 'passed', checks, pageErrors: errors, externalRequests: outsideRequests, projectCount: 3, basicInfoCount: 1 }
  await writeFile(new URL('result.json', output), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await context.close()
  await browser.close()
}
