# atomEDU product video script

Target length: 5 minutes. Speakers: Rahul Awasthi and Pritam Avuthu. Read at a natural pace, about 130 words per minute. The [slide presentation](../product-video.html) follows these cues. Use real product capture from the current site. The screenshots linked below are framing references, not a substitute for showing the live product in the finished video.

## 0:00 to 0:23 | Slide 1 | On camera

**Rahul:** "I'm Rahul Awasthi. This is Pritam Avuthu. We built atomEDU because we kept seeing the same thing happen in math: a student works through a problem, enters an answer, and gets a red X. That X tells them almost nothing about the thinking that led there."

**Screen:** Both speakers, then the atomEDU name on a dark background.

## 0:23 to 0:46 | Slide 2 | The problem

**Pritam:** "A student can make one small mistake, keep working carefully, and still end up wrong. Or they can guess the right answer without understanding it. We wanted a tool that looks at the work itself and points to the step where the reasoning changed."

**Screen:** Show [a student's submitted lines before checking](./product-video-assets/check-input-screen.png), then submit them in the next scene.

## 0:46 to 1:18 | Slide 3 | Solve

**Rahul:** "Here is Proof Lab. I can enter a problem the way I would write it on paper. Take this rational function: f of x equals two over x minus three, plus one. Solve gives me more than a final expression. It shows the domain, intercepts, asymptotes, and the steps behind the result. It also keeps the restriction x cannot equal three in view."

**Screen:** Enter `f(x)=2/(x-3)+1` in Solve. Pause on the [verified result](./product-video-assets/solve-screen.png), then reveal one or two timeline steps.

## 1:18 to 1:55 | Slide 4 | Check work

**Pritam:** "Now let's put in a student's steps. The problem is three x plus two equals two times x plus four. In the first line, I distribute the two to x but forget to distribute it to four. Proof Lab stops at that exact step. It says the two must multiply both terms. The later lines may follow my mistaken line, but they do not fix the original error."

**Screen:** Submit the [example with the incorrect first step](./product-video-assets/check-screen.png). Highlight the first-error label and the explanation.

## 1:55 to 2:18 | Slide 5 | Ghost steps

**Rahul:** "When a student skips a valid intermediate step, we can fill in the missing reasoning as a Ghost step. Here the same idea helps show a corrected continuation: two times x plus four becomes two x plus eight. The correction is labeled separately so nobody mistakes it for work the student actually submitted."

**Screen:** Scroll to the [verified Ghost steps](./product-video-assets/ghost-screen.png). Keep the label visible.

## 2:18 to 2:44 | Slide 6 | Practice

**Pritam:** "Students can make fresh practice problems too. Pick a supported topic, set the difficulty from zero point zero zero zero to one point zero zero zero, and generate a problem. The same problem can go straight into Check work or Solve. A seed lets us reproduce it, which helps when a student and teacher want to discuss the same question."

**Screen:** Change the difficulty slider, then [generate a problem](./product-video-assets/generate-screen.png).

## 2:44 to 3:13 | Slide 7 | Graph

**Rahul:** "On Graph, I can plot a function, zoom, pan, and switch to log axes or a polar grid. I can even turn an image into math waves and enter our daily graph-art contest. The plot is numerical. We use the separate proof checker for mathematical claims."

**Screen:** Plot `y=sin(x)` on the [graph](./product-video-assets/graph-screen.png). Zoom once, briefly open Image import, and point to the numerical label.

## 3:13 to 3:42 | Slide 8 | How the engine works

**Pritam:** "The math engine is software we wrote for this job. It parses the problem, chooses a rule family, computes a candidate result, and checks a certificate before it calls that result verified. Difficulty uses three routing tiers, but the answer still has to pass the checker. If a problem falls outside a supported rule, Proof Lab says so. That boundary matters to us."

**Screen:** Show a simple four-line sequence: input, rule, result, verification. Do not imply that three independently trained models exist.

## 3:42 to 4:05 | Slide 9 | Share

**Rahul:** "A teacher can also work with a graph outside this screen. Copy its link, or choose Share to Google Classroom and select a class there. The link carries the graph expressions and window settings. It is a simple way to bring a student-made graph into a classroom conversation."

**Screen:** Show the [copyable graph link and Classroom button](./product-video-assets/share-screen.png). Do not call atomEDU an official Google partner.

## 4:05 to 4:37 | Slide 10 | People and progress

**Pritam:** "We started in O'Fallon, Missouri. We have reached 3,640-plus users, and VC Boom and MedAestheticsOS are our featured corporate partners. What matters most to us is what happens when somebody sees exactly where their work changed. We want the next attempt to make sense, not just produce a different number."

**Screen:** Show the two partner marks with their approved names. Use the current user count only after checking the analytics before filming.

## 4:37 to 5:00 | Slide 11 | On camera

**Rahul:** "Bring a problem you are working on."

**Pritam:** "Show your steps, even if you are unsure about them."

**Rahul:** "Proof Lab can help you find the first place to look again."

**Together:** "Start at atom-edu.org."

**Screen:** Both speakers and the site address. Hold the end frame for three seconds.

## Recording notes

- Record the live demonstrations at 1024 by 768 or wider. Keep each expression and the first-error explanation readable in the final edit.
- Use the actual rule-based product. Do not say it solves every Algebra I, Algebra II, Geometry, or Precalculus problem. The [current coverage checklist](./standards-coverage.md) records the limits.
- Verify the 3,640+ user figure and partner permissions immediately before recording. Do not treat Google Classroom compatibility as a Google partnership.
- The product screenshots were captured from the public site on November 15, 2026. Re-record them if the interface changes before publication.
