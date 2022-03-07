module.exports = {
    frequency: 10 * 60,
        mail: {
        to: 'me@gmail.com',
        smtp: {
           host: "smtp.gmail.com",
           port: 465,
           user: "sender@gmail.com",
           password: "verystrongpass"
        }
    },
    checks: [
        {
            id: 'generaliste2',
            url: 'https://www.doctolib.fr/doctor-queen/paris/femme-medecin',
            refuseReplace: false,
            teleHealth: false,
            motive: '3124',
            wantedBefore: 7,
            weekDays: ['mon', 'wed']
        }
    ]
};
