#!/usr/bin/env nodejs
const createLogger = require('js-libs/logger').default
const config = require('./config');
const puppeteer = require('puppeteer-core');
const moment = require('moment');
const nodemailer = require("nodemailer");
const _ = require('lodash');
const {EventEmitter} = require('events');
const logger = createLogger('debug')

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

            await this.transporter.sendMail({
                from: '"Doctolib alert" <localhost>', // sender address
                to: this.mailConfig.to, // list of receivers
                subject, // Subject line
                text: text, // plain text body
                html: "<b>"+text+"</b>", // html body
                attachments
              })
        })
    }
}

const availabilities = new Availabilities

if (config.mail) {
    const mailNotifier = new MailNotifier(config.mail)
    mailNotifier.subscribe(config.checks, availabilities)
}

async function run() {
    const browser = await puppeteer.launch({
        defaultViewport: null,
        executablePath: process.env.CHROMIUM_PATH,
        // --disable-gpu avoid RPI to freeze on newPage() after one browser close
        args: ['--start-maximized', '--disable-features=site-per-process', '--no-sandbox', '--disable-gpu'],
        headless: process.env.HEADLESS === 'false' ? false : true
    });

    async function doJob(config, page) {

        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');

        await page.setViewport({ width: 1280, height: 800 })
        await page.setRequestInterception(true);

        async function getAvail() {

            return new Promise((resolve) => {
                let handler;

                page.on('request', request => {
                    const isXhr = ['xhr','fetch'].includes(request.resourceType())
                    const isAvail = request.url().includes('availabilities.json')
                    if (isXhr && isAvail){

                        const lookAhead = typeof config.wantedBefore === 'number' ? config.wantedBefore : 14;

                        request.continue({
                            url: request.url().replace('limit=4', 'limit=' + lookAhead)
                        })

                    } else {
                        request.continue()
                    }
                })

                page.on('response', handler = response => {
                    const isXhr = ['xhr','fetch'].includes(response.request().resourceType())
                    const isAvail = response.url().includes('availabilities.json')
                    if (isXhr && isAvail){

                        logger.debug('Response', {status: response.status()})

                        response.text().then(text => resolve(JSON.parse(text)))
                        page.off('response', handler)
                    }
                })

                setTimeout(() => page.off('response', handler), 60 * 1000)

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

        await page.goto(config.url);

        logger.info('Url loaded')

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

        const dates = getNextDates(await avail)

        logger.debug('Get next dates', {dates})

        const newValue = dates.length > 0 ? dates : null;

        logger.info('New value', {newValue})

        availabilities.update(config.id, newValue)
    }

    const security = setTimeout(() => {
        logger.info('Closing browser (security anti freeze)')
        browser.close()
    }, config.checks.length * 60 * 1000)

    for(let conf of config.checks) {
        let page
        try {
            page = await browser.newPage();
            logger.info('Let\'s go !', { status: 'running', id: conf.id })
            await doJob({...config, ...conf}, page)
            await new Promise(resolve => setTimeout(resolve, 5000))
            logger.info('Oh yeah !', { status: 'done', id: conf.id })
        } catch (e) {
            logger.error(
                e.toString(),
                {
                    status: 'failed',
                    id: conf.id,
                    e,
                    screenshot: page ? 'data:image/png;base64,' + await page.screenshot({encoding: 'base64'}) : null
                }
            )
        }
        if (page) {
            await page.close()
        }

    }
    await browser.close();
    clearTimeout(security)
    setTimeout(run, (config.frequency || 10 * 60) * 1000);
}

run();
