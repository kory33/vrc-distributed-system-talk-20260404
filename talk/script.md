# モデル検査入門 - 分散アルゴリズムの正当性について

Description: This is the initial draft script of the planned talk. I've fed all context I had in my mind to ChatGPT (through text + voice), made it write a draft following my rough plan and then heavily edited it to reach the current status.

Language of this draft: English 

Audience: a small distributed-systems meetup, likely including professional software engineers who may not necessarily be familar with mathematical logic or formal methods.

## Context and aims of the talk

This talk is **not** designed to be a sales pitch for formal methods tools,
nor an attempt to convince the audience that they should immediately start using
theorem provers or model checkers in their daily work.

The real aim is to give the audience a way to think about the following questions:

- What is a **specification**, really?
- In what sense can specifications be made precise enough that we can (algorithmically) check systems against them?
- What is a **model** of a system, and how is it different from the real system?
- What are formal methods actually trying to do, and what are they **not** able to do?
- (slightly outside the scope of the talk, but): how should software engineers think about responsibility, correctness and justification, especially in a future where AI systems increasingly generate code?

The intended message is roughly this:

1. A specification is not merely a document passed around by a manager. 
   It is, more fundamentally, something that downstream people can **rely on** in order to reason about outcomes.

2. Formal methods are one family of techniques for making specifications precise enough to be mechanically checked. 
   But the formalized specification **may** not be the same thing as the real-world intent behind the specification.

3. Models are useful precisely because they are **not** reality. 
   They live in a mathematical world, and we use them to predict and reason about reality.
   The gap is structurally unavoidable, but useful.

4. Current formal methods are powerful but are not silver bullets (as always). 
   They are not the final form of software engineering, and they do not yet solve everything.

5. Even so, this line of thinking matters, because software engineering is inseparable from responsibility and explainability.
   If outcomes are not specified in a form people can rely on, nontrivial downstream reasoning becomes impossible.

This draft is therefore trying to balance:
- accessibility for a non-specialist technical audience,
- one concrete technical example, namely CTL model checking,
- and a broader philosophical / engineering message about responsible software development.

## Suggested framing at the very beginning

Before I start, let me tell you what kind of talk this is.

This is partly a technical talk, but not only that. There are a few different things mixed together here.

- If you are mainly interested in day-to-day software engineering, I want you to pay attention to the parts where I talk about **specifications**, **responsibility**, and what it means to justify the behavior of software.
- If you are interested in the more technical side, then the part on **CTL** and **model checking** is probably where you should lean in. As new technical tools, you will learn about Kripke structures (a directed graph together with a valuation) and CTL formulas.

Also, this talk is not trying to tell you that one particular tool is the answer. I am not here to say “everybody should go use Lean”, or “everybody should specify with TLA+”, or “CTL model checking is the right way to verify software”.

Instead, what I want to do is give you a conceptual map:
- what a specification is,
- what a model is,
- what model checking is trying to do,
- what theorem proving is trying to do,
- and how to think about these technologies without either overestimating them or dismissing them.

---

# Talk draft

## Opening

Today I want to talk about model checking, distributed algorithms, and correctness.

But really, the question underneath all of this looks rather non-technical:

**What does it mean to say that a system is correct?** And **what does it take you to say so?**

Before answering these questions, we should spend some time considering the following:

**What is a specification?**

If you work in software, the word “specification” probably already means something to you. Maybe it means a requirements document. Maybe it means a design doc. Maybe it means a ticket. Maybe it means a message from a product manager.

That is certainly one use of the word, and it is a practical one. But today I want to push us toward a rather different view. That is how we start the journey.

## Specs are "Constraints from Expectations"

In Japanese, “仕様” might feel more like a general *outline* of what a system does. In English, however, "specification" has a connotation of "specifying", "pinpointing" and "normatively constraining" what the system should or *could* do.

I would like to take this intuition further and even say that, for our purpose, the word *specification* stands for 「システムが何をしなければならないかを指定し、制約する期待」.

A specification is not merely the PDF or the wiki page or the requirements document that your project manager passes onto you. Their *intended expectations* are the specifications, and the *documents* themselves are just the medium! For those documents to be useful at all, they must *specify* meaningfully what the system is supposed to do, and there lies what specifications are.

So the first thing I want you to unlearn is the idea that “specification” just means a human-written document passed from one person to another.

It is the *standard* an implementation is *expected to* meet. "Expected", by whom, you might ask, and that's the appropriate question. I had to say "expected to", because it is typically stakeholders who are holding such expectation.

## Specs as Things We (Software Engineers) Rely On

From the point of view of stakeholders, specifications are expectations that constrain implementations.

Now, if you are a software engineer, you *might* be thinking: "OK, but I am not a stakeholder. I am the implementer. Why should *I* care about specifications? They are just boring standards to which I have to comply". That is a very honest and good question! My answer is, well, you *are* a stakeholder!

Imagine yourself writing a function (TODO: write a concrete function name here). You were most probably forced to writing that function because a "past you" had some expectation about what the function should do. Maybe you had an idea of how it should be used, or maybe you had a vague notion of what it should accomplish. That expectation can be considered a specification, and if you do not fulfill it, then you have failed to meet your own expectations.

Before you even start writing the function, you are already its stakeholder. *More importantly*, *after* you have written the function, you *still are* (and likely will remain to be) a stakeholder of the function, because you will almost certainly use it yourself (if not, why have you written it?). (footnote: Recursive functions are interesting because they force you to be a user of the function specification *while writing the body of the function*. I've written about this on Twitter a while ago: https://x.com/Kory__3/status/1785847683238023279)

When you are about to use the function, you *expect* it to do something useful for you, and to be certain that your function is the right thing to use, you need to assume that the function meets its specification, and that that specification is the property you really need at that moment.

In fact, *every single time* you use or invoke any form of existing code, you are relying on some specification. If a library says, “this function sorts a list”, you use that function because you expect it to sort a list. If a consensus algorithm says, “no two different values can appear as an answer to a query asking for the value”, that statement is not just a slogan. It is something an application built on top of that algorithm will likely fundamentally depend on.

So a yet another way to think about a specification is this:

> A specification is a statement about behaviour (of a system or a module) that we rely on in order to make downstream reasoning possible.

If a particular behaviour of a function is left *unspecified*, *morally*, you *cannot* assume that the function works the way you wished it to. *There is nobody to whom you can shift the blame*. If the function says it returns a permutation of the input list in a non-decreasing order, but does not mention what happens if two elements don't compare, you cannot assume stability (if two non-comparing elements will come out in the same order as they went in) of the sorting function.

And that is why specifications matter. If outcomes are not specified in a way that can be relied on, then downstream reasoning becomes impossible, or at least extremely fragile. (footnote: closely related to this topic is the notion of "contract")

## Formal Specifications

Specifications can often be *informal*, and this brings about two notable issues:
- They may not be objective, in the sense that different people *may* have different interpretations of what the specification actually means. That is, two different people may judge (not by mistakes) differently whether a certain implementation meets the specification or not.
- We cannot mechanically check whether an implementation meets the specification.

The first problem creates a burden for both the user and the implementor of a system, and the latter problem reduces the confidence of the user that the implementation actually does what it is advertising it should do.

This is where formal methods enter the picture.

Formal specifications are specifications that are written in *formal languages*, and they are *much easier* to handle algorithmically compared to specifications in natural languages. Eliminating ambiguity in natural languages is generally difficult, but we *can design* formal languages so that every statement has a precise meaning.

Note that I am not saying that *every* specification can be formalized. In fact, I believe that many real-world specifications are very difficult to formalize (e.g. how would you formally specify that your game character doesn't clip into the wall with a given world asset? Just saying "the character doesn't clip into the wall" is a lot easier than defining what that really means, precisely because the natural language description is sweeping all the complexity under the rug (i.e. people's "common sense")).

There are however specifications that can be written down with formal languages, and I will focus on those parts.

*Model checking*, which is today's main topic, is one family of techniques for checking whether a formal specification holds in a formal model of the system.

## Before “model checking”, what is a model?

Before I say “model checking”, I need to pause on the word **model**.

A model is a simplified stand-in for a real system.
In this talk I will roughly use the word “model” to mean a
*piece of data that we prepare in order to represent some aspect of a real system*.

A good analogy would be a *map*.

A map is *not* the terrain. It does not contain every wall, every building,
every crack in the road, every moving object. It just *represents* the Earth's surface by displaying the structure of the terrain.

That is exactly why it is useful. It deliberately throws away detail in order to
 - let you focus on the things that matter for navigation, and to
 - fit the map onto a piece of paper.

A model **abstracts** *and hence* **simplifies** the reality.

A map is just a piece of paper with lines and symbols on it.
Actually, we can even say that the map being drawn on a piece of paper is unimportant,
and outright say that a map is a combination of carefully placed lines and symbols.
With this view, a map is *just a piece of data*.
Therefore, we can put this piece of data into a computer, and then we can write algorithms that operate on it.
Route planning on Google Maps is a prominent example of that.

## OK, so What do Formal Methods do?

At this point, I can say what formal methods are:

You *model* real systems as mathematical models, such as directed graphs. Then, you prove (either by computation or by deduction) some *formal* property, which you *think* corresponds to a property of the real system, of the model. Once you establish that the model satisfies the formal property, you conclude that the real system likely satisfies the desired property.

<!-- NOTE: This script is heavily skewed towards model checking and in a sense is not a fair description of formal methods, because the term "formal methods" typically just points to an area where mathematically rigorous arguments are applied in design and analysis of software. However, we *could* argue that logic-based analysis of software (such as type systems or Hoare/separation logic) are yet another form of model checking, because programs are themselves mathematical models of "physical on-chip realization of software" (https://x.com/Kory__3/status/2037186072405524544). For a less radical treatment of the word, see https://www.cs.ox.ac.uk/people/michael.wooldridge/teaching/soft-eng/lect06.pdf for example. -->

Instead of establishing that *the system* is correct (which could be, in many ways, extremely challenging), we model the system as a formal object that we think *represents* the system and then establish a property *about the model* through some (typically machine-assisted) procedure.

When we prove something about the mathematical object, that fact does not automatically jump back into reality. What we get is not direct certainty about the real system. What we get is a *prediction* about the real system, based on a few assumptions:

- if this real system is adequately represented by this model,
- and if the property we wrote down adequately captures the requirement we care about,
- and if our checking procedure is sound,

then we gain confidence that the real system has the relevant property.

<!-- ↓ I'll keep these in mind but they add unnecessary burden to the audience, so we skip this part. However, I should probably mention that there are formal methods which are not particularly tied to checking mathematical models (like type systems and ITPs).

To name a few examples of the formal methods:
- model checking checks that a model of system (e.g. Kripke frame or transition system) conform to a formal specification (e.g. logical formula)
- refinement checking checks that "implementation" models do not "do anything more mischievous than" "specification" models that do whatever  spec-conforming models would do
- a type system checks that terms conform to types. Terms and types can be thought of as abstractions of implementations and properties (cf. Curry-Howard Correspondence)
- (and more...)

These are all different attempts at making assertions *formal enough* so that they become machine-checkable.

-->

## One concrete path: Kripke structures + Temporal Logic

Now I want to get more concrete and technical.

Suppose I have a system with states:
- maybe a trafic light system in a crossing,
- maybe a lock implementation,
- maybe a transaction protocol,
- maybe a consensus system.

Then one way to describe that system mathematically is as a transition structure:
a graph of states, where edges represent possible next steps, together with a *valuation* describing the area at which a given (atomic) property holds. These are (for historical reasons) called *Kripke structures*.

We now know what the model should be, and we need a formal language to describe properties of Kripke structures. One family of logics we can use to describe their properties is **temporal logic**.

The idea of temporal logic is that we do not just say what is true in a single state, but we also talk about what must hold in the next "tick", or in the future. There are a few variants of temporal logic, but one concrete example we talk about today is **CTL**, the Computation Tree Logic.

<!-- ↓ Justifications for choocing CTL. No need to say this unless asked.

I am choosing CTL today not because it is the best tool for distributed systems (I suppose it is *not*!), but because it is a reasonably accessible example of what it looks like to specify properties over a state space and check them algorithmically.

To name a few other temporal logics, there are:
- LTL (Linear Temporal Logic),
- CTL\* (essentially a combination of LTL+CTL),

-->

## (Very Brief) Introduction to CTL

In CTL, formulas are built from:
- ordinary propositions about a state,
- boolean connectives such as ∧ (“and”) and ¬ (“not”),
- and *temporal operators*.

Temporal operators talk about "future transitions" in the model. The main important ones are: 

- ∃〇 φ (read as "there exists a next state where φ holds")
- ∃□ φ (read as "there exists a path where φ will always hold")
- ∃U(φ, ψ) (read as "there exists a path where ψ holds at some point, and φ keeps holding until then")

(TODO: Put some concrete examples here. I think crossing traffic light system is a good example, because the transition system is small enough to be drawn.)

## What is model checking?

Let's do a small recap. So the Kripke-Structure-plus-CTL setup was this: given
1. a model of the system, such as a Kripke structure,
2. and a formula, such as a CTL formula,

the problem we need to solve is

> does this model satisfy this formula?

One thing I like about CTL as a teaching example is that the (naive) checker can be implemented in a very small amount of code.
At least at the toy level, the core ideas fit in a compact recursive evaluator plus a few graph algorithms.
It is something you can actually implement in a small prototype and inspect line by line.

## CTL Model Checker

(TODO: Talk about the fix-point treatment of ∃□ and ∃U. This should be easy once we prepare enough graph-manipulation primitives.)

## A distributed-systems-flavored example

Because this is a distributed systems gathering, let's imagine a small consensus-like system.

(TODO: talk a bit about 2PC and its (failing) verification.)

## This *Might* Matter to You!

Now let me make the larger claim. Even if you never use CTL, even if you never touch Lean or Rocq, even if you never write a model checker, I still think this matters.

Why? Because software engineering is not only about making things run. It is also about being able to answer questions like:

- What does this system guarantee?
- Under what assumptions?
- Why do we believe that?
- What was checked?
- What remains unchecked?

My claim is this: those questions become more important, not less important, when code becomes cheap with generative AIs. Accordingly, *the ability to take responsibility* will be more scarce compared to the amount of code, and software engineering as a discipline *may* steer toward taking *more* responsibility reliably, at scale.

Perhaps proof exploration will become cheaper too. Perhaps formal artifacts will become easier to generate. Perhaps not perfectly, perhaps not reliably, perhaps not soon enough for many use cases. But even in that world, the central question remains:

> What has actually been shown, and why should I trust that interpretation?

Unless you are doing research specifically about how to prove things (IMO mathematicians are more likely to be in that category), most of the time you only care whether some claim has actually been established.

I believe that, to use such technology responsibly, you need the ability to read off:
- what the formal statement says,
- what it does not say,
- and why someone is entitled to rely on it.

If that sounds relevant to your work, then I think the study of mathematical logic and formal methods is worth your attention.

---

## What I want you to take away

So let me summarize the real message of this talk.

1. **A specification is not just a document**: It is an expectation about the system, something that unlocks reliance and downstream reasoning.
2. **A model is not the real system**: It is a mathematical stand-in, useful precisely because it is abstract.
3. **Verification always happens relative to a model and assumptions**: This is not a weakness unique to formal methods; it is the structure of the problem.
4. **CTL model checking is one concrete example** of how we can represent a system mathematically, write down requirements formally, and mechanically check whether they hold.
5. **You do not have to adopt these tools tomorrow!** 
   ...But I do hope you leave with the ability to judge what they are trying to do, where they may matter, and how to recognize when they become relevant to your own work.

---

## Closing

If I have done this talk well, then even if you never become a formal methods person, I hope at least one thing has shifted. I hope the next time someone says “specification”, you do not hear only “document”. I hope you also hear:

- something that constrains implementations,
- something to rely on,
- something that can sometimes be formalized,
- something that may support responsibility,
- and something whose precision determines what kinds of claims can responsibly be made.

And if that shift happens, I think this talk has succeeded.

---

# Appendix: notes to self for tone

- Do not overstate what formal methods can do.
- Do not present CTL as “the correct approach”.
- Repeatedly distinguish:
  - real-world requirement,
  - formal property,
  - real implementation,
  - mathematical model.
- Keep bringing the audience back to responsibility and downstream reasoning.
- Use one recurring distributed-systems example if possible.
- If time is short, compress technical details before compressing the conceptual framing.
