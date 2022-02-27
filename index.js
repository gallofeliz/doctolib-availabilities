#!/usr/bin/env nodejs

const config = require('./config');
const puppeteer = require('puppeteer-core');
const moment = require('moment');
const nodemailer = require("nodemailer");
const {EventEmitter} = require('events');

class Availabilities extends EventEmitter {
    constructor() {
        super()
        this.availabilities = {}
    }

    update(id, value) {
        const previousValue = this.get(id)

        const strPreviousValue = previousValue instanceof Object ? previousValue.toString() : previousValue
        const strValue = value instanceof Object ? value.toString() : value

        if (strPreviousValue === strValue) {
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

            const text = value instanceof Error
                ? id + ' ' + value.toString()
                : id + ' ' + moment(value).format('YYYY-MM-DD') + ' ' + checks.find(check => check.id === id).url

            const subject = value instanceof Error
                ? 'Doctolib Availability Error'
                : 'New Doctolib Availability'

            await this.transporter.sendMail({
                from: '"Doctolib alert" <localhost>', // sender address
                to: this.mailConfig.to, // list of receivers
                subject, // Subject line
                text: text, // plain text body
                html: "<b>"+text+"</b>", // html body
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

    async function doJob(config) {

        console.log('Doing ' + config.id)

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');

        await page.setViewport({ width: 1280, height: 800 })

        async function getAvail() {

            return new Promise((resolve) => {
                let handler;
                page.on('response', handler = response => {
                    const isXhr = ['xhr','fetch'].includes(response.request().resourceType())
                    const isAvail = response.url().includes('availabilities.json')
                    if (isXhr && isAvail){

                        response.text().then(text => resolve(JSON.parse(text)))
                        page.off('response', handler)
                    }
                })

                setTimeout(() => page.off('response', handler), 60 * 1000)

            })

        }

        const avail = getAvail()

        function getNextSlot(avail) {
            if (avail.next_slot) {
                return avail.next_slot;
            }

            // Todo : use https://www.doctolib.fr/availabilities.json?start_date=2021-07-22&visit_motive_ids=2460309&agenda_ids=391618&insurance_sector=public&practice_ids=155768&limit=14

            let excludes = []
            if (config.refuseReplace) {
                avail.availabilities.forEach(day => {
                    Object.values(day.substitution || {}).forEach(sub => {
                        excludes = excludes.concat(sub.slots)
                    })
                })
            }

            const dispo = avail.availabilities.find(day => day.slots.filter(slot => !excludes.includes(slot)).length > 0)
            return dispo ? dispo.date : null
        }

        await page.goto(config.url);

        try {
            await page.click('#didomi-notice-agree-button');
        } catch (e) {
        }

        if (config.alreadySeen === false) {
            await page.click('label[for=all_visit_motives-1]');
        } else if (config.alreadySeen === true) {
            await page.click('label[for=all_visit_motives-0]');
        }

        if (config.teleHealth === false) {
            await page.click('input[name="telehealth"][value="physicalAppointment"]');
        } else if (config.teleHealth === true) {
            await page.click('input[name="telehealth"][value="videoAppointment"]');
        }

        if (config.motiveCat) {
            await page.select('#booking_motive_category', config.motiveCat);
        }

        if (config.motive) {
            await page.select('#booking_motive', config.motive);
        }

        const date = getNextSlot(await avail)
        let newValue = null;

        await page.close()

        if (date) {
            let maxDate = config.wantedBefore;
            if (typeof config.wantedBefore === 'number') {
                maxDate = moment().add(config.wantedBefore, 'days').format('YYYY-MM-DD')
            }

            if (date < maxDate) {
                newValue = date
            }
        }

        console.log('next date', config.id, date)

        availabilities.update(config.id, newValue)
    }

    const security = setTimeout(() => {
        console.log('Closing browser (security anti freeze)')
        browser.close()
    }, config.checks.length * 60 * 1000)

    for(let conf of config.checks) {
        try {
            await doJob({...config, ...conf})
            await new Promise(resolve => setTimeout(resolve, 5000))
        } catch (e) {
            console.error(e)
            availabilities.update(conf.id, e)
        }
    }
    await browser.close();
    clearTimeout(security)
    setTimeout(run, (config.frequency || 10 * 60) * 1000);
}

run();
