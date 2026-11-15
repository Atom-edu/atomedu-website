# atomEDU product demo script

Target length: about 12 minutes, within a 10 to 15 minute recording. Speakers: Rahul Awasthi, Aryan Patel, and Pritam Avuthu. Rahul opens, and the three speakers share the narration evenly. Rahul covers the student-work checks, Pritam covers solving and the engine, and Aryan covers the editor, practice, graph, and sharing. The [15-slide presentation](../product-video.html) follows the scenes below. Timing includes time to click, scroll, and let the audience read the screen.

## 0:00 to 0:40 | Slide 1 | Rahul opens

**Rahul:** "Hi, I'm Rahul Awasthi. This is atomEDU, and today we're going to show you Proof Lab. We started building it in O'Fallon, Missouri, after watching students work hard on a problem and get only a right or wrong mark at the end. That mark doesn't say where the reasoning changed. We wanted to give students a useful next step, even when their final answer was wrong. I'll show you the idea, then we'll take you through the product together."

**Screen:** Rahul on camera for the first sentence, then the atomEDU logo and title. Hold the cover briefly before moving on.

## 0:40 to 1:20 | Slide 2 | Rahul explains the problem

**Rahul:** "Think about a student who distributes a number incorrectly. They can do several more lines of perfectly consistent work and still end up with a wrong answer. If we only grade the last line, we miss the one point where help would matter. Proof Lab lets a student put in their own steps. It checks the transitions between those steps and explains the first one that breaks. Aryan, show us what that looks like."

**Screen:** Show [the submitted lines before checking](./product-video-assets/check-input-screen.png). Move the pointer down the student's steps without submitting yet.

## 1:20 to 2:10 | Slide 3 | Aryan shows the visual editor

**Aryan:** "I'm Aryan Patel. I want to start with how you enter a problem, because if that feels awkward, the rest of the tool doesn't matter. Here is the visual math field. I can type directly, or open the math pad for a fraction, square root, exponent, inequality, or symbol. The gray boxes are places to fill in. I click the box I want, enter my value, and move to the next one. If I need the raw notation, I can open the LaTeX source, but I don't have to type LaTeX just to use Proof Lab."

**Screen:** Use the [editor and math pad](./product-video-assets/editor-screen.png). On the live site, insert a fraction and move between its two placeholders. Close the pad before the next scene.

## 2:10 to 2:55 | Slide 4 | Pritam solves a function

**Pritam:** "I'm Pritam Avuthu. Let's try this function: f of x equals two over x minus three, plus one. I press Solve. The result shows the function, its domain, intercepts, asymptotes, and other supported features. The important detail is x cannot equal three. That restriction is part of the mathematical answer. If we simplify a rational expression and forget where the original denominator was zero, we can accidentally claim a value that was never allowed. Proof Lab keeps that boundary visible."

**Screen:** Enter `f(x)=2/(x-3)+1`. Show the [verified function analysis](./product-video-assets/solve-screen.png) and pause on the domain line.

## 2:55 to 3:40 | Slide 5 | Pritam follows the proof timeline

**Pritam:** "Below the result is the proof timeline. It starts with one step, so I can read it instead of getting a wall of equations at once. I can press Show next step and see the next transformation and its rule. Notice the difference between a displayed formula and a verified step. The math is checked by the engine. The LaTeX badge only tells us that the notation renders properly. We show those separately because a nicely typeset answer can still be mathematically wrong."

**Screen:** Scroll to the [proof timeline](./product-video-assets/timeline-screen.png). Press Show next step twice. Keep the rule label and verified marker in view.

## 3:40 to 4:30 | Slide 6 | Rahul checks student work

**Rahul:** "Now let's look at the student's work from the beginning. The problem is three x plus two equals two times x plus four. In the first submitted line, I changed the right side to two x plus four. I multiplied the x by two, but not the four. When I check the work, Proof Lab identifies that first line as invalid and explains the distribution error. The lines after it might follow from the mistaken line. They don't repair the original problem. The correct distribution is two x plus eight, and the actual solution is x equals six."

**Screen:** Submit the [incorrect first step](./product-video-assets/check-screen.png). Highlight the first-error label, the explanation, and the contrast with later locally valid lines.

## 4:30 to 5:15 | Slide 7 | Rahul shows Ghost steps

**Rahul:** "Students do not have to write every tiny algebra move. If a jump is valid and the engine can reconstruct what happened, Ghost steps show the missing checkpoints. When a submitted step is wrong, a corrected continuation can also appear. It is labeled as a correction, not as something the student wrote. Here you can see two times x plus four become two x plus eight, then the equation moves toward x equals six. That gives the student a path back into the problem without pretending their original line was correct."

**Screen:** Scroll to the [verified Ghost steps](./product-video-assets/ghost-screen.png). Pause on the label that distinguishes the correction from submitted work.

## 5:15 to 6:00 | Slide 8 | Aryan generates practice

**Aryan:** "Proof Lab can also make practice problems. I choose a supported topic and move the difficulty slider. It runs from zero point zero zero zero to one point zero zero zero, with three decimal places. Then I generate a problem. I can bring that problem into Check work to solve it myself, or open it in Solve to study the engine's method. The seed makes the problem reproducible. If a student asks a teacher about a question, both people can work from the same one. The generator creates these questions locally from our own templates and rules."

**Screen:** Choose a topic, move the difficulty slider, and [generate one problem](./product-video-assets/generate-screen.png). Point to the seed and the two follow-up buttons.

## 6:00 to 6:45 | Slide 9 | Aryan explores the graph

**Aryan:** "The graph helps me see what a function is doing. I'll enter y equals sine of x. I can pan, zoom, compare curves, and change the window. There are logarithmic axis options and a polar grid for selected topics. This is numerical graphing, so the picture is a way to explore. When I say a solution step is verified, that claim comes from the separate rule checker, not from a curve looking right on a screen. We keep that distinction visible in the graph view."

**Screen:** Plot `y=sin(x)` on the [graph](./product-video-assets/graph-screen.png). Zoom once and point to the numerical label.

## 6:45 to 7:30 | Slide 10 | Pritam shows image import and art

**Pritam:** "There is also a creative side to the graph. Under Image import, I can choose a picture and ask Proof Lab to approximate it with waves, straight lines, or colored regions. The formulas it uses appear in the expression list, so the result remains math that I can inspect and adjust. A complex photo will only be an approximation. Students can save graph art as a PNG and enter our daily graph-art contest. The art has to come from atomEDU's graph, and the contest has its own rules and judging."

**Screen:** Open [Image import](./product-video-assets/image-import-screen.png). Show the drawing styles without claiming the conversion is exact. Then briefly show Save PNG and the Art contest entry point.

## 7:30 to 8:20 | Slide 11 | Pritam explains the engine

**Pritam:** "The mathematical part of Proof Lab is a rule-based engine we build and test ourselves. It parses the expression, selects a supported rule family, computes a candidate result, and checks that result before it marks it verified. The checker can replay the certificate against the input. This matters when a result looks plausible but was reached through an invalid step. We want the verified label to mean something specific. We also test examples that should be rejected, so an unsupported or incorrect step is not silently accepted."

**Screen:** Show the four terms on the slide: Input, Rule, Result, Verification. Pause on Verification.

## 8:20 to 9:05 | Slide 12 | Pritam explains routing and limits

**Pritam:** "The difficulty value also helps route a problem. Values below zero point four zero zero start in the first tier. The middle tier runs up to zero point six five zero, and the third tier handles the higher range. If a quick inspection shows a problem needs a higher tier, the router moves it up. These are routing levels over our math modules, not three separately trained models. The tool covers selected Algebra I, Algebra II, Geometry, and Precalculus rule families. It does not cover every question in those courses. When it cannot prove a result, we label the limit."

**Screen:** Show the three difficulty ranges and the coverage note. Do not present the ranges as a universal measure of mathematical difficulty.

## 9:05 to 9:50 | Slide 13 | Aryan shares a graph

**Aryan:** "Back in Graph, I can copy a link to the current graph. That link includes the expressions and window settings, so somebody opening it sees the same setup. There is also a Share to Google Classroom button. A teacher chooses the class in Google Classroom. This is a simple sharing workflow, and you should avoid putting private information into a graph link. atomEDU is for use with Google Classroom, but we are not claiming an official Google partnership. The graph remains editable when the recipient opens the atomEDU link."

**Screen:** Show the [copyable graph link and Classroom control](./product-video-assets/share-screen.png). Copy the link, open it in a separate tab, and confirm that the expression restores.

## 9:50 to 10:45 | Slide 14 | Rahul talks about people and progress

**Rahul:** "We built this in O'Fallon, Missouri, as students ourselves. The tool has reached 3,640-plus users, based on our current count, and VC Boom and MedAestheticsOS are our featured corporate partners. Those facts matter because they show that people are actually using what we're making. We still have more math to cover, and we want teachers and students to tell us where it helps and where it falls short. The first thing we want someone to get from Proof Lab is a clearer picture of their own reasoning. That is how the next attempt gets better."

**Screen:** Show the partner marks and user figure. Verify the current count and permission to use each mark before recording.

## 10:45 to 12:00 | Slide 15 | All three close

**Rahul:** "Aryan, if someone opens Proof Lab for the first time, where should they begin?"

**Aryan:** "Bring a problem you are already trying to solve. Start in Check work if you have steps written down. Put them in as you wrote them, even if you are unsure. If a line breaks, the feedback should point you to that line. Then try the corrected path yourself. If you want to understand the engine's method first, open Solve and reveal the timeline one step at a time. And if you want a new question, choose a topic in Generate."

**Pritam:** "Use the graph to explore. Use the checker when you need a supported proof. If the engine says it cannot verify something, take that seriously and tell us what you tried."

**Rahul:** "Proof Lab is free to use. You can start at atom-edu.org."

**Aryan:** "Bring the math. Show the steps. We'll help you find the place to look again."

**Screen:** Show Rahul, Aryan, and Pritam on camera, then their individual portraits and the atomEDU logo. Hold the site address for five seconds.

## Recording notes

- Rahul opens before the first screen share and demonstrates Check work and Ghost steps. Aryan demonstrates the editor, Generate, Graph, and sharing. Pritam demonstrates Solve, the proof timeline, image import, and the engine. Hand off the live product controls between speakers at scene changes.
- Record the demonstrations at 1024 by 768 or wider. Pause on the first-error explanation, a Ghost step, and a proof timeline rule long enough to read them.
- Use the actual rule-based product. Do not claim full Algebra I, Algebra II, Geometry, or Precalculus coverage. The [current coverage checklist](./standards-coverage.md) records the limits.
- Verify the 3,640+ user figure and partner mark permissions before filming. Do not call atomEDU an official Google Classroom partner.
- The screenshots were captured from the public site on November 15, 2026. Re-record scenes if the interface changes before publication.
