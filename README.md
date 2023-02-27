# doctolib-availabilities

![](https://github.com/gallofeliz/doctolib-availabilities/blob/master/doctolib.png)

## Features

- Add checks for your doctor/health consultation you want with the new UI
- Edit them with the UI (including disable them)
- Test them
- Automatic checks running
- Automatic notify (mail) when availabilites are available
- Docker native (See docker-compose for an example)

Unfortunaly, I had problems with pupeeter and I switch node user to root. I don't like root on containers, so it should be good to put a non-privilegied user back.

## Note

Turn off headless with `sudo HEADLESS=false docker-compose up`

Display (X11) support is not mandatory in default case of headless true.

The code is ugly (the developer seems to be very noob). It should be refactorised but for the moment I don't have time to spend on it.
