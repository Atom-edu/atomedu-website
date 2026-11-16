# atomEDU product demo script

Target length: 20 minutes. Speakers: Rahul Awasthi, Aryan Patel, and Pritam Avuthu. Rahul opens. The [20-slide presentation](../product-video.html) follows the scenes below. Each scene has about one minute for narration, screen actions, and a short pause for the viewer to read. Rehearse with the live site and adjust the pauses rather than rushing through the math.

## 0:00 to 1:00 | Slide 1 | Rahul opens

**Rahul:** "Hi, I'm Rahul Awasthi. Welcome to atomEDU. We built Proof Lab because a right or wrong mark at the end of a math problem rarely tells you what to do next. A student may understand most of an equation and make one small mistake that changes the answer. We wanted a tool that could find that moment, explain it, and let the student keep going. Today Aryan, Pritam, and I will show you the actual product. We'll enter a problem, solve one, check our own work, generate practice, and explore the graph. We'll also show you what the engine verifies and where its limits are. You can follow along at atom-edu.org."

**Screen:** Begin on camera. Show the atomEDU cover and logo, then open Proof Lab. Leave a beat before the first screen share.

## 1:00 to 2:00 | Slide 2 | Rahul explains the problem

**Rahul:** "Here is the sort of mistake that started this project. A student sees three x plus two equals two times x plus four. They write the next line as three x plus two equals two x plus four. It looks close. But the two outside the parentheses has to multiply both terms inside. The right side should be two x plus eight. If the student keeps solving from the mistaken line, later steps may be internally consistent, but the final answer still belongs to a different equation. A plain answer checker would say wrong. We want to show the student which line changed the problem. Keep this example in mind. We will come back and submit those steps."

**Screen:** Show [the submitted lines before checking](./product-video-assets/check-input-screen.png). Trace the right side of the first equation with the pointer.

## 2:00 to 3:00 | Slide 3 | Aryan enters math

**Aryan:** "I'm Aryan Patel. First, let me put a problem into Proof Lab. The main field is a visual math editor, so I can type an equation directly. When I need a fraction or a square root, I can open the math pad. These gray spaces are fill-in boxes. I click the numerator, enter a value, then move to the denominator. The same idea works for exponents and other templates. I can also open the LaTeX source if I want to inspect the notation, but ordinary use doesn't require writing LaTeX code. Watch me enter the rational function we're going to solve. I'll leave the pad closed afterward so we can focus on the result."

**Screen:** Use the [editor and math pad](./product-video-assets/editor-screen.png). Insert a fraction, move between placeholders, enter `f(x)=2/(x-3)+1`, and close the pad.

## 3:00 to 4:00 | Slide 4 | Pritam solves a function

**Pritam:** "I'm Pritam Avuthu. This is f of x equals two over x minus three, plus one. I press Solve and the engine works through the supported features of that function. Start with the domain. The denominator is zero at x equals three, so x equals three has to stay out of the answer. We can see the vertical asymptote at the same x value. We can also inspect the intercepts and the horizontal behavior. The point is to keep the conditions attached to the result. If someone cancels or rewrites an expression without checking the original denominator, they may allow a value that was never defined. In a math tool, that detail matters as much as the final formula."

**Screen:** Show the [verified function analysis](./product-video-assets/solve-screen.png). Pause on the domain and asymptote. Scroll slowly enough to read one result at a time.

## 4:00 to 5:00 | Slide 5 | Pritam reveals the proof timeline

**Pritam:** "There is more below the answer. Proof Lab has a timeline of steps, and it reveals them gradually. I'll click Show next step rather than display the entire solution at once. Each entry names the transformation so a student can ask whether that move makes sense. There are two labels here worth separating. LaTeX validation means the math notation can be read and displayed. Mathematical verification means the supported result or step has been checked against the original problem. A pretty equation is not automatically a valid one. Let me open the next step, read the rule, and compare it with what we started from. That is the habit we want students to practice."

**Screen:** On the [proof timeline](./product-video-assets/timeline-screen.png), reveal two steps. Keep the rule text and verification marker visible for several seconds.

## 5:00 to 6:00 | Slide 6 | Rahul checks student work

**Rahul:** "Now let's return to our student's equation. I put their lines into Check work in the same order they wrote them. The first submitted move claims that two times x plus four becomes two x plus four. When I submit, Proof Lab identifies that line as the first invalid transition. It explains the distribution error and shows the correct expansion, two x plus eight. Notice that it does not simply mark the final answer wrong and leave the student to guess why. It also does not pretend that later steps repair the original equation. The actual solution to this problem is x equals six. We can compare that with the answer the student reached from the altered equation."

**Screen:** Submit the [incorrect first step](./product-video-assets/check-screen.png). Point to the first-error label and the explanation. Let the result settle before moving on.

## 6:00 to 7:00 | Slide 7 | Rahul explains Ghost steps

**Rahul:** "Students don't normally write every single arithmetic move. That is fine. If the jump they made is valid and our engine can reconstruct the missing reasoning, Ghost steps show the checkpoints in between. They are visually separate from what the student actually submitted. In this example, the submitted line was wrong, so the tool can also show a corrected continuation. That correction has its own label. We never want a teacher looking at the screen to think the student wrote a line that the engine supplied. Follow the equation down from the corrected distribution to x equals six. The student gets a way back into the problem, but their original mistake remains visible and understandable."

**Screen:** Show the [Ghost-step correction](./product-video-assets/ghost-screen.png). Pause on the label that distinguishes the correction from submitted work.

## 7:00 to 8:00 | Slide 8 | Aryan generates practice

**Aryan:** "After feedback, the next useful move is practice. I'll switch to Generate, choose a supported topic, and create a new question. The difficulty control has values from 0.000 to 1.000 in thousandths. It helps select a family and starting tier, but a single number cannot describe every way a math problem might be difficult. We also have a seed. If I use the same topic, difficulty, and seed again, I can reproduce the question. That is helpful when a student wants to show a teacher exactly what they were working on. The generator uses our own rules and templates. It is creating a question for the engine, not calling an outside chatbot to invent one."

**Screen:** Choose a topic and [generate a problem](./product-video-assets/generate-screen.png). Show the difficulty control, seed, and follow-up actions.

## 8:00 to 9:00 | Slide 9 | Aryan graphs a function

**Aryan:** "Now let's look at Graph. I can enter y equals sine of x and see the wave across the coordinate plane. I'll add a second expression so we can compare shapes and where they cross. The expressions remain editable on the left. I can pan the plane, zoom in, and zoom back out without changing the underlying formulas. That makes the graph useful for building intuition about a function. I want to be precise about one thing: this view is numerical. A curve that looks like it crosses an axis at a certain place is a clue, not a proof of an exact answer. When we need to call a step verified, the rule checker has to do that separately."

**Screen:** Plot `y=sin(x)` in the [graph view](./product-video-assets/graph-screen.png), add a second supported expression, and zoom once.

## 9:00 to 10:00 | Slide 10 | Aryan changes the graph window

**Aryan:** "The graph has a few ways to change the view. Here is the window setting. I can choose which x and y values are visible and reset after a zoom. For some questions I can use a logarithmic axis. For others, a polar grid makes the shape easier to understand. These controls change the picture, not the problem. I can hide one expression, turn it back on, or move through several equations without losing the rest of my work. On a phone, the expression list and the graph share the screen, so I can move between them. The aim is to let a student test a visual idea, then go back to the exact math when the question needs proof."

**Screen:** Use the [wide graph view](./product-video-assets/graph-wide.png). Open window settings, adjust a bound, reset, and briefly show one alternative grid or axis mode.

## 10:00 to 11:00 | Slide 11 | Pritam explains the engine

**Pritam:** "Behind those screens is a rule-based mathematics engine that our team builds and tests. It reads the input, identifies a supported kind of problem, and applies the relevant operations. There is a separate checking path for the result. We don't ask a language model to say whether an equation looks right. A result can carry a certificate that the verifier replays against the input. That is how we try to make the word verified specific and testable. We also write cases the engine must reject, including false steps and unsupported forms. Those tests matter because a checker that accepts a convincing-looking mistake is worse than one that honestly says it cannot verify it."

**Screen:** Show Input, Rule, Result, Verification on the slide. Pause on Verification. Do not describe the tiers as separate trained models.

## 11:00 to 12:00 | Slide 12 | Pritam explains the three tiers

**Pritam:** "You may have noticed three difficulty ranges. Below 0.400, a problem starts in the first tier. From 0.400 through 0.649 it starts in the second. From 0.650 through 1.000 it starts in the third. A quick inspection can send a problem higher when the first route is too simple. These are routing tiers over supported math modules. They are not three independent artificial intelligence models. The number helps us choose an efficient starting point, while the proof check decides whether the answer can carry a verified label. Some problems can be easy to state but hard to prove, so the boundaries are practical engineering choices rather than universal rankings of mathematical difficulty."

**Screen:** Point to each difficulty band. Hold long enough for the audience to read the decimal boundaries.

## 12:00 to 13:00 | Slide 13 | Aryan shares a graph

**Aryan:** "Once I have a useful graph, I can copy a link to this setup. It includes the expressions and window settings, so someone else can open the same view and keep exploring. I'll copy the link and open it in another tab. The curve and the window come back. There is also a Share to Google Classroom control. A teacher can choose a class and place the graph link into their own classroom workflow. We describe this as a feature for use with Google Classroom. It does not mean atomEDU has an official partnership with Google. One practical note: the link contains the graph setup. Don't put private student information in an expression or title you plan to share."

**Screen:** Use the [sharing controls](./product-video-assets/share-screen.png). Copy a graph link, open it in a new tab, and confirm that the expressions restore.

## 13:00 to 14:00 | Slide 14 | Rahul introduces the team and progress

**Rahul:** "We started atomEDU in O'Fallon, Missouri, as students who wanted better feedback on our own math. The tool has reached more than 3,640 users based on our current count, and our featured corporate partners are VC Boom and MedAestheticsOS. Those numbers and names matter to us because real people are trying what we've built. They also raise the standard for what we publish. If a result is confusing, or a rule is missing, we want to hear about it. The team behind the product includes me, Pritam, Aryan, and Akshaj Sanikommu. Today three of us are walking through the demo, and all four of us are part of the company."

**Screen:** Show the partner marks and user figure. Verify the current user count and permission to display each mark before filming.

## 14:00 to 15:00 | Slide 15 | Aryan demonstrates a study session

**Aryan:** "Let's put the pieces together as one study session. I start in Generate and choose a problem I have not solved yet. Instead of pressing Solve immediately, I bring that problem into Check work and write my first line. I add the next line as I would on paper. Then I check my work. If the checker finds a bad transition, I stop there and try to correct it myself before I reveal the full answer. If I skipped a valid move, Ghost steps can fill in the gap. Only after that do I open Solve to compare methods. This order keeps the student's thinking in the middle of the experience rather than making the tool do every move first."

**Screen:** Show the [work-checking view](./product-video-assets/check-work.png). Demonstrate the Generate to Check work handoff, then pause before revealing a solution.

## 15:00 to 16:00 | Slide 16 | Pritam explains verification

**Pritam:** "I want to show what the verified badge means more carefully. The solver can produce an answer and a record of how it got there. The verifier checks that record against the original input. If the certificate does not match, the result cannot simply be promoted to verified because the displayed expression looks plausible. The same separation applies when students submit their own work. We check the transition they made, including restrictions that may be easy to overlook. This is still software, and software can have bugs, which is why we test both accepted and rejected cases. But it gives us a concrete claim we can inspect: this particular supported result passed these particular checks."

**Screen:** Show the [solved result](./product-video-assets/solve.png). Point out the verification status and contrast it with notation or display validation.

## 16:00 to 17:00 | Slide 17 | Pritam describes coverage

**Pritam:** "What can it do today? The supported list includes selected rule families from Algebra I and II, Geometry, and Precalculus. That includes common equations and inequalities, functions, coordinate geometry, and several proof patterns with explicit premises. The exact list matters more than a broad course name. A student might see a topic called Geometry and assume every diagram proof is available, but many geometry problems rely on a diagram or an unstated fact that a formal checker cannot safely assume. Inside Proof Lab we show the families the engine knows how to handle. We add new ones by implementing rules and writing tests, not by declaring that a whole textbook has been covered."

**Screen:** Show the [topic choices](./product-video-assets/generate.png) and open the current coverage list in Proof Lab. Do not claim full curriculum coverage.

## 17:00 to 18:00 | Slide 18 | Pritam describes limits

**Pritam:** "There are also clear limits. A graph can suggest where a curve crosses an axis, but a screen pixel is not an exact algebraic proof. A LaTeX expression can render perfectly while the underlying mathematical claim is false. Some operations are valid notation but outside the solver's supported rules."

**Rahul:** "In those cases, we want the product to say partial, unsupported, or unverified, instead of dressing a guess up as a proof. If a student sees that label, they can still use the graph to investigate or ask a teacher to review the work. They should not treat an unsupported case as a verified answer."

**Aryan:** "Being clear about what we cannot yet check is part of making the tool useful."

**Screen:** Compare the [curve view](./product-video-assets/graph-curves.png) with a verified Solve result. Point to the numerical label on Graph.

## 18:00 to 19:00 | Slide 19 | Rahul offers a starting point

**Rahul:** "If this is your first visit, bring one real problem you are already trying to solve. You do not need to learn every mode at once. Open Check work, enter the problem, and write a step you are unsure about. Read the first explanation before you open the complete solution. If you are stuck before the first line, use Solve to see a supported method one step at a time. If you want another attempt, generate a question in the same topic. Teachers can use the graph link when they want a class to compare the same functions. We are building around a simple habit: write the reasoning, check the transition, and try again."

**Screen:** Show the [atomEDU entry point](./product-video-assets/home-screen.png), then return to Proof Lab with Check work selected.

## 19:00 to 20:00 | Slide 20 | All three close

**Rahul:** "That's Proof Lab. We began with a student who had one broken line in an otherwise familiar equation. The tool found that line and gave the student a way to continue. Aryan, what would you tell someone trying it tonight?"

**Aryan:** "Use a problem you care about. Type it in the visual field, show your own steps, and read the first piece of feedback. You can explore a function on the graph or generate a new question after that. Keep the work yours. The tool is here to help you see it more clearly."

**Pritam:** "And check the status labels. A verified step has passed a specific rule check. A numerical graph or an unsupported case has a different purpose. We want you to know which is which. If you find a gap, tell us. That helps us improve the engine."

**Rahul:** "You can start at atom-edu.org. Thanks for spending this time with us."

**Screen:** Show Rahul, Aryan, and Pritam on camera, then the founder portraits and atomEDU logo. Hold the site address for five seconds.

## Recording notes

- Record a rehearsal with a timer. Each scene has one minute, including the listed action and a reading pause. Shorten cursor movement before shortening the math explanation.
- Hand off the controls between speakers at scene changes. Rahul opens and handles the student's work. Aryan handles the editor, practice, graph, and sharing. Pritam handles Solve, the proof timeline, engine, and limits.
- Record the demonstrations at 1024 by 768 or wider. Pause on the first-error explanation, a Ghost step, and a proof-timeline rule long enough to read them.
- Use the actual rule-based product. Do not claim full Algebra I, Algebra II, Geometry, or Precalculus coverage. The [current coverage checklist](./standards-coverage.md) records the limits.
- Verify the 3,640+ user figure and partner mark permissions before filming. Do not call atomEDU an official Google Classroom partner.
- The product screenshots were captured from the public site on November 15, 2026. Re-record scenes if the interface changes before publication.
