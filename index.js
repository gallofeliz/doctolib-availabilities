#!/usr/bin/env nodejs
const createLogger = require('@gallofeliz/js-libs/logger').default
const loadConfig = require('@gallofeliz/js-libs/config').default
const config = loadConfig({ filename: 'config.js' })
const puppeteer = require('puppeteer');
const moment = require('moment');
const nodemailer = require("nodemailer");
const _ = require('lodash');
const {EventEmitter} = require('events');
const logger = createLogger(config.log?.level || 'info')
const uuid4 = require('uuid').v4
const {handleExitSignals} = require('@gallofeliz/js-libs/exit-handle')
const fs = require('fs')
const checksPath = '/data/checks.json'
const got = require('got')

function loadChecks() {
    try {
        return require(checksPath)
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            throw e
        }
        return []
    }
}

function saveChecks() {
    fs.writeFileSync(checksPath, JSON.stringify(checks))
}

const checks = loadChecks()

handleExitSignals()

const HttpServer = require('@gallofeliz/js-libs/http-server').default

const api = new HttpServer({
    port: '80',
    webUiFilesPath: 'webui',
    logger,
    api: {
        prefix: 'api',
        routes: [
            {
                method: 'GET',
                path: '/checks',
                handler(req, res) {
                    res.send(checks)
                }
            },
            {
                method: 'POST',
                path: '/checks',
                handler(req, res) {
                    const check = req.body

                    if (!check.url || !check.id || typeof check.enabled != 'boolean' || !check.wantedBefore ) {
                        throw new Error('Invalid check')
                    }

                    checks.push(check)
                    saveChecks()
                    res.status(201)
                    res.end()
                }
            },
            {
                method: 'PUT',
                path: '/checks/:id',
                handler(req, res) {
                    const check = req.body
                    const id = req.params.id

                    if (!check.url || !check.id || typeof check.enabled != 'boolean' || !check.wantedBefore ) {
                        throw new Error('Invalid check')
                    }

                    checks.splice(checks.indexOf(checks.find(check => check.id === id)), 1, check)

                    saveChecks()
                    res.status(201)
                    res.end()
                }
            },
            {
                method: 'POST',
                path: '/debug/check',
                async handler(req, res) {
                    const check = req.body

                    if (!check.url || check.enabled !== true || !check.wantedBefore ) {
                        throw new Error('Invalid check')
                    }

                    try {
                        const newValue = await run(check)
                        res.send({
                            success: true,
                            newValue
                        })
                    } catch (e) {
                        res.send({
                            success: false,
                            error: e
                        })
                    }
                }
            },
            {
                method: 'PATCH',
                path: '/batch/checks',
                async handler(req, res) {
                    const ids = req.query.ids
                    const patch = req.body

                    const targetChecks = ids.map(id => checks.find(check => check.id === id))

                    if (targetChecks.includes(undefined)) {
                        throw new Error('Missing check')
                    }

                    targetChecks.forEach(check => {
                        Object.assign(check, patch)
                    })

                    saveChecks()
                    res.status(201).end()
                }
            },
            {
                method: 'GET',
                path: '/last-error-snapshot',
                handler(req, res) {
                    res.sendFile('/tmp/debug.png')
                }
            },
            {
                method: 'GET',
                path: '/debug/run',
                handler(req, res) {
                    run()
                    res.end()
                }
            }
        ]
    }
})

api.start()

function toStr(e) {
    if (e instanceof Error) {
        return e.toString()
    }

    if (e instanceof Array) {
        return e.join()
    }

    if (e === null || e === undefined) {
        return e
    }

    return e.toString()
}

class Availabilities extends EventEmitter {
    constructor() {
        super()
        this.availabilities = {}
    }

    update(id, value) {
        const previousValue = this.get(id)

        if (toStr(previousValue) === toStr(value)) {
            return
        }

        this.availabilities[id] = value

        this.emit('change', id, value, previousValue)
    }

    get(id) {
        return this.availabilities[id]
    }

    getAll() {
        // Should be cloned, but I am lazy
        return this.availabilities
    }
}

class MailNotifier {
    constructor(mailConfig) {
        this.mailConfig = mailConfig
        this.transporter = nodemailer.createTransport({
            host: mailConfig.smtp.host,
            port: mailConfig.smtp.port,
            secure: mailConfig.smtp.port === 465, // true for 465, false for other ports
            auth: {
              user: mailConfig.smtp.user, // generated ethereal user
              pass: mailConfig.smtp.password, // generated ethereal password
            }
        });
    }

    subscribe(checks, availabilities) {

        availabilities.on('change', async (id, value, previousValue) => {

            if (!value) {
                return
            }

            let text;
            const attachments = []

            if (value instanceof Error) {
                text = id + ' ' + value.toString()

                if (value.screenshot) {
                    text += '<img src="cid:screenshot"/>'

                    attachments.push({
                        filename: 'screenshot.jpg',
                        content: value.screenshot,
                        cid: 'screenshot'
                    })
                }

            } else {
                text = id + ' (' + checks.find(check => check.id === id).url + ')'

                const groups = _.groupBy(value, e => e.split('T')[0])

                _.forEach(groups, (dates, date) => {
                    text += "\n\n" + date + ' :'

                    dates.forEach(d => {
                        if (d.includes('T')) {
                            d = d.split('T')[1] // Can be formatted by moment :)
                        }
                        text += '\n- ' + d
                    })
                })
            }

            const subject = value instanceof Error
                ? 'Doctolib Availability Error'
                : 'New Doctolib Availability'

            try {
                await this.transporter.sendMail({
                    from: this.mailConfig.from || '"Doctolib alert" <localhost>', // sender address
                    to: this.mailConfig.to, // list of receivers
                    subject, // Subject line
                    text: text, // plain text body
                    html: "<b>"+text.replace(/\n/g, '<br/>')+"</b>", // html body
                    attachments
                  })
            } catch (e) {
                logger.error('Mail error', {e})
            }
        })
    }
}

const availabilities = new Availabilities

if (config.mail) {
    const mailNotifier = new MailNotifier(config.mail)
    mailNotifier.subscribe(checks, availabilities)
}

async function run(testConf) {
    logger.info('Starting browser')
    const browser = await puppeteer.launch({
        defaultViewport: null,
        //executablePath: process.env.CHROMIUM_PATH,
        // --disable-gpu avoid RPI to freeze on newPage() after one browser close
        args: ['--start-maximized', '--disable-features=site-per-process', '--no-sandbox', '--disable-gpu'],
        headless: process.env.HEADLESS === 'false' ? false : 'new'
    });
    
   logger.info('Browser started')

    async function doJob(config, page, logger) {
        
        logger.info('Doing job', config)

        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

        await page.setViewport({ width: 1920, height: 1080 })
        await page.setRequestInterception(true);

        let intercepted = false;
        const isHapicare = config.url.includes('hapicare.fr')

        if (isHapicare) {
            // Please refactor this shitty code
            return await (async () => {
                const data = await got(config.url).json()
                let value = data.firstAvailabilityDate

                if (value) {
                    let maxDate = config.wantedBefore;
                    if (typeof config.wantedBefore === 'number') {
                        maxDate = moment().add(config.wantedBefore, 'days').format('YYYY-MM-DD')
                    }

                    if (moment(value).format('YYYY-MM-DD') > moment(maxDate).format('YYYY-MM-DD')) {
                        value = null
                    }
                }

                if (value && config.weekDays) {
                    if (!config.weekDays.includes(moment(value).format('ddd').toLowerCase())) {
                        value = null
                    }
                }

                const val = value ? [value] : null

                logger.info('New value', {val})

                return val
            })()
        }

        async function getAvail() {

            return new Promise((resolve, reject) => {
                let handler1;
                let handler2;

                page.on('request', handler1 = request => {
                    const isXhr = ['xhr','fetch'].includes(request.resourceType())
                    const isAvail = request.url().includes('availabilities.json')


                    if (intercepted) {
                        //logger.debug('network abort request ' + request.url())
                        request.abort()
                        return
                    }

                    //logger.debug('network request ' + request.url())

                    if (isXhr && isAvail){

                        const lookAhead = typeof config.wantedBefore === 'number' ? config.wantedBefore : 14;

                        const newUrl = request.url().replace('limit=', 'limit=' + lookAhead + '&')

                        //logger.debug('Interception ' + request.url() + ' ; sending ' + newUrl)

                        intercepted = true

                        request.continue({
                            url: newUrl
                        })

                    } else {
                        request.continue()
                    }
                })

                page.on('response', handler2 = async response => {
                    const isXhr = ['xhr','fetch'].includes(response.request().resourceType())
                    const isAvail = response.url().includes('availabilities.json')

                    //logger.debug('network response ' + response.request().url())

                    if (isXhr && isAvail){

                        if (response.status() !== 200) {
                            return reject(new Error('Response error : ' + await response.text()))
                        }

                        //logger.debug('I resolved the solution !!')
                        resolve(JSON.parse(await response.text()))
                    }
                })

                setTimeout(() => page.off('response', handler2), 60 * 1000)

            })

        }

        const avail = getAvail()


        function getNextDates(avail) {
            let slots = [];

            logger.debug('Reading avail', {avail})

            if (avail.error) {
                throw new Error(JSON.stringify(avail.error))
            }

            if (avail.next_slot) {
                slots.push({
                    replace: false,
                    date: avail.next_slot
                })
            }

            (avail.availabilities || []).forEach(day => {
                if (!day.slots || day.slots.length === 0) {
                    return;
                }

                day.slots.forEach(slot => {
                    slots.push({
                        replace: false,
                        date: slot
                    })
                })

                Object.values(day.substitution || {}).forEach(substitution => {
                    substitution.slots.forEach(subSlot => {
                        let slot;
                        if (slot = slots.find(slot => slot.date === subSlot)) {
                            slot.replace = true;
                        }
                    })
                })

            })

            slots = config.refuseReplace
                ? slots.filter(s => s.replace === false)
                : slots

            let maxDate = config.wantedBefore;
            if (typeof config.wantedBefore === 'number') {
                maxDate = moment().add(config.wantedBefore, 'days').format('YYYY-MM-DD')
            }

            slots = slots.filter(s => moment(s.date).format('YYYY-MM-DD') <= moment(maxDate).format('YYYY-MM-DD'))

            if (config.weekDays) {
                slots = slots.filter(s => config.weekDays.includes(moment(s.date).format('ddd').toLowerCase()))
            }

            return slots.map(s => s.date)
        }

        try {
            await page.goto(config.url);
            logger.info('Url loaded')

            if (!config.url.includes('booking/availabilities?')) {

                await page.waitForSelector('#booking-content');

                try {
                    await page.click('#didomi-notice-agree-button');
                    logger.info('Agree Button clicked')
                } catch (e) {
                    logger.info('Agree Button no clicked (error)', {e})
                }

                if (config.alreadySeen === false) {
                    await page.click('label[for=all_visit_motives-1]');
                    logger.info('AlreadySeen false selected')
                } else if (config.alreadySeen === true) {
                    await page.click('label[for=all_visit_motives-0]');
                    logger.info('AlreadySeen true selected')
                }

                if (config.teleHealth === false) {
                    await page.click('input[name="telehealth"][value="physicalAppointment"]');
                    logger.info('Telehealth false selected')
                } else if (config.teleHealth === true) {
                    await page.click('input[name="telehealth"][value="videoAppointment"]');
                    logger.info('Telehealth true selected')
                }

                if (config.motiveCat) {
                    await page.select('#booking_motive_category', config.motiveCat);
                    logger.info('MotiveCat selected')
                }

                if (config.motive) {
                    await page.select('#booking_motive', config.motive);
                    logger.info('Motive selected')
                }

            }
        } catch (e) {
            if (intercepted) {
                logger.notice('Goto error', {e})
            } else {
                throw e
            }
        }

        const dates = getNextDates(await avail)

        logger.debug('Get next dates', {dates})

        const newValue = dates.length > 0 ? dates : null;

        logger.info('New value', {newValue})

        return newValue
    }

    const enabledChecks = testConf
        ? [testConf]
        : checks.filter(check => check.enabled)
    
    let page
    const security = setTimeout(async () => {
        logger.error('Closing browser (security anti freeze)')
        setTimeout(run, (config.frequency || 10 * 60) * 1000);
        if (page) {
            await page.screenshot({path: '/tmp/debug.png'})
        }
        browser.close()
    }, enabledChecks.length * 60 * 1000)

    let testValue
    
    logger.info('Entering for')

    for(let conf of enabledChecks) {

        const sessionLogger = logger.child({
            id: conf.id,
            sessionId: uuid4()
        })
        try {
            logger.info('Go Go !')
            page = await browser.newPage();
            sessionLogger.info('Let\'s go !', { status: 'running' })
            const newValue = await doJob({...config, ...conf}, page, sessionLogger)
            if (!testConf) {
                availabilities.update(conf.id, newValue)
            } else {
                testValue = newValue
            }
            logger.info('All right')
            await new Promise(resolve => setTimeout(resolve, 5000))
            sessionLogger.info('Oh yeah !', { status: 'done' })
        } catch (e) {
            if (testConf) {
                testValue = e
            }
            sessionLogger.error(
                e.toString(),
                {
                    status: 'failed',
                    e//,
                    // Bad idea
                    //screenshot: page ? 'data:image/png;base64,' + await page.screenshot({encoding: 'base64'}) : null
                }
            )
            try {
                await page.screenshot({path: '/tmp/debug.png'})
            } catch {}
        }
        if (page) {
            await page.close()
        }

    }
    await browser.close();
    clearTimeout(security)
    if (!testConf) {
        setTimeout(run, (config.frequency || 10 * 60) * 1000);
    } else {
        if (testValue instanceof Error) {
            throw testValue
        }
        return testValue
    }
}

setTimeout(run, (Math.min(config.frequency, 1) || 10 * 60) * 1000);
